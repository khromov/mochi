---
title: 'Queues'
slug: queues
ogTitle: 'Background jobs with Mochi.queue()'
description: 'Run background jobs with Mochi.queue(), backed by bun-boss on memory, SQLite, Postgres, or embedded PGlite storage.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
  import PersistenceTable from './_components/PersistenceTable.svelte';
</script>

## Queues

<VersionNote since="0.10.0" message="Mochi.queue was reworked in 0.10.0: descriptors are named and directly usable, and the serve-level queues option takes an array of them. This page documents the new API." />

Offload work that should not block a response — sending email, encoding media, calling slow APIs — to a background **queue**. A queue bundles a job channel with the `process` function that consumes it. Both run in your process, backed by [bun-boss](https://github.com/khromov/bun-boss).

<PersistenceTable feature="queues" />

`Mochi.queue(name, …)` returns a descriptor that is both the declaration and the producer handle. Mount it in the `Mochi.serve({ queues })` array to start its worker; call `.add()` on it from anywhere:

```ts
import { Mochi } from 'mochi-framework';

export const emails = Mochi.queue<{ to: string }>('emails', {
  concurrency: 10,
  process: async (job) => {
    await sendEmail(job.data.to);
    return { sent: true };
  },
});

await Mochi.serve({
  routes: {/* … */},
  queues: [emails],
});

// from a page action, an API route, anywhere:
await emails.add({ to: 'alice@example.com' });
```

### `Mochi.queue()`

```ts
const queue = Mochi.queue<JobData, Result>(name, { process, ...options });
```

`process` receives a read-only `MochiJob<T>` and returns the job result. Omit it for a queue that only receives jobs — e.g. a [dead-letter](#dead-letter-queues) holding pen.

| Field        | Type     | Notes                                   |
| ------------ | -------- | --------------------------------------- |
| `id`         | `string` | job id                                  |
| `data`       | `T`      | the enqueued payload                    |
| `queue`      | `string` | queue name                              |
| `attempt`    | `number` | 1-based attempt number (1 on first run) |
| `enqueuedAt` | `number` | epoch ms when enqueued                  |

Queue-level options are inherited by every job: `concurrency`, `pollingIntervalSeconds`, [retries](#retries) (`retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`), `expireInSeconds`, `retentionSeconds`, `deleteAfterSeconds`, `deadLetter`, [`worker`](#worker-tuning), [`storage`](#standalone-producers). Every duration is in **seconds**. `on` registers lifecycle listeners:

```ts
Mochi.queue('emails', {
  concurrency: 10,
  process,
  on: {
    completed: (job, result) => log.info(`${job.id} done`),
    failed: (job, error) => log.warn(`${job.id} failed: ${error.message}`),
  },
});
```

Or subscribe on the [`mochiEvents` bus](#observability) (filter by `queue` name) when the listener lives far from the queue declaration.

### Adding jobs

The descriptor itself is the producer handle — import it and add. `Mochi.getQueue<JobData>(name)` resolves the same handle by name, for call sites that should not import the declaring module; it throws for a name that was never declared, or before `Mochi.serve()` mounted its queues.

| Method                                     | Returns                   | Notes                                       |
| ------------------------------------------ | ------------------------- | ------------------------------------------- |
| `add(data, opts?)`                         | `Promise<string \| null>` | enqueue one job, resolves its id            |
| `addBulk(jobs)`                            | `Promise<string[]>`       | enqueue many in one call                    |
| `addThrottled(data, seconds, key?, opts?)` | `Promise<string \| null>` | at most one job per `seconds` slot per key  |
| `addDebounced(data, seconds, key?, opts?)` | `Promise<string \| null>` | like throttled, but books the next slot too |

Per-job options override their queue-level counterparts: `priority`, `startAfter` (seconds, or a `Date`), `id`, `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`, `expireInSeconds`.

```ts
await emails.add({ to: 'bob@example.com' }, { priority: 10, startAfter: 5 });
await emails.addBulk([{ data: { to: 'a@x.com' } }, { data: { to: 'b@x.com' }, opts: { priority: 10 } }]);
```

<Callout type="info">

**`add()` can resolve `null`.** Passing an explicit `id` makes the add idempotent — a second add with the same id resolves `null` instead of duplicating the job. Throttled and debounced adds resolve `null` when the slot is already taken. A plain `add()` always resolves an id. `addBulk` skips jobs whose explicit `id` already exists, so it can resolve fewer ids than jobs submitted.

</Callout>

### Standalone producers

A script whose only job is _enqueueing_ — an external scheduler, a CLI backfill, a migration — can write straight to queue storage. (For recurring work inside the server process, use [scheduled jobs](/docs/scheduled-jobs/) instead.) Give the descriptor `storage` and its first `add()` lazily connects a **producer-only** runtime; tear down with [`Mochi.stop()`](#mochistop):

```ts
// enqueue.ts — a standalone producer script
import { Mochi } from 'mochi-framework';

const emails = Mochi.queue<{ to: string }>('emails', {
  storage: { postgres: process.env.DATABASE_URL! },
});

await emails.addBulk(jobs);
await emails.stop();
```

- A producer declaring no options simply ensures the queue exists. Declared options are enforced like everywhere else — [config is code-authoritative](#storage) — and a descriptor-form [`deadLetter`](#dead-letter-queues) is created with its link intact even when the producer runs first on fresh storage. To consume without a server, see [standalone workers](#standalone-workers).
- `queue.stop()` stops that queue in this process — its worker deregisters after in-flight jobs finish, and the shared runtime closes once the last active queue stops. [`Mochi.stop()`](#mochistop) remains the whole-app teardown; under `Mochi.serve()` queues stop with the server.
- Your app has **one queue storage**. Declare it on the descriptor (`storage`), app-wide via the serve-level [`queueStorage`](#storage) option, or both when they agree — conflicting declarations are a boot error. Standalone, a descriptor without `storage` throws on `add()`.
- `Mochi.serve()` inherits the descriptors' storage when `queueStorage` is unset, and a serve on the same storage adopts an already-connected standalone runtime — on a different storage it refuses to start.
- `mochi:queuesMounted` fires only under `Mochi.serve()`. For a standalone producer, readiness is the first `add()` resolving.

### Standalone workers

`Mochi.worker()` is the consuming counterpart: a process that polls and runs `process` without serving HTTP. `start()` connects to the app's queue storage — from the descriptors, or the worker's own `queueStorage` option — ensures the queues exist, and begins polling:

```ts
// worker.ts — a standalone worker script
import { Mochi, consoleLogger } from 'mochi-framework';
import { emails } from './queues';

consoleLogger();

const worker = Mochi.worker({ queues: [emails] });
await worker.start();

process.on('SIGINT', async () => {
  await Mochi.stop();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await Mochi.stop();
  process.exit(0);
});
```

Queue config follows the same rule as every other path — [code is authoritative](#storage): a worker creates missing queues with their full declared config ([`deadLetter`](#dead-letter-queues) links included, targets first) and refuses to start when storage disagrees; `Mochi.worker({ queueConfig: 'sync' })` writes the declared config to storage instead. `worker.stop()` deregisters the worker's queues (waiting for in-flight jobs) while the runtime stays up for producing; `Mochi.stop()` tears the runtime down.

<Callout type="info">

**Standalone means standalone.** `Mochi.worker()` installs no signal handlers (wire them yourself, as above), fires no hooks or startup milestones, and subscribes no logger — call `consoleLogger()` for the `QUEUE` lines. A process that calls `Mochi.serve()` declares its queues there instead; `start()` refuses to run alongside it.

</Callout>

### Worker tuning

The rarely-needed bun-boss fetch options ride along in `worker`, forwarded to the worker verbatim: `orderByCreatedOn`, `priority`, `minPriority`, `maxPriority`, `ignoreStartAfter`, `notifyPollingIntervalSeconds`, `burstWhenReadyExceeds`, `heartbeatRefreshSeconds`.

```ts
Mochi.queue('plugin-info', {
  process: fetchPluginInfo,
  worker: { orderByCreatedOn: false, minPriority: 10 },
});
```

Mochi-owned settings (`concurrency`, `pollingIntervalSeconds`, and the per-job settlement contract) win where they overlap. `worker` options apply at fetch time only; stored queue options stay as declared.

### Storage

One store serves every queue — declared app-wide via the serve-level `queueStorage` option, or inherited from a [`storage`](#standalone-producers) declared on the descriptors:

```ts
await Mochi.serve({
  queues: [/* … */],
  queueStorage: 'memory', // the default
  // queueStorage: { sqlite: '.db/queue.sqlite' },
  // queueStorage: { postgres: process.env.DATABASE_URL },
  // queueStorage: { pglite: await PGlite.create('.db/queue-pglite') },
});
```

| Storage                | Survives restarts | Scope                                            |
| ---------------------- | ----------------- | ------------------------------------------------ |
| `'memory'`             | no                | single process                                   |
| `{ sqlite: path }`     | yes               | single process, one durable file                 |
| `{ postgres: url }`    | yes               | shared — multiple processes can work one backlog |
| `{ pglite: instance }` | yes (on-disk)     | single process, embedded in-process Postgres     |

See [Persistence](/docs/persistence/) for how queue storage compares to the other stateful Mochi features.

Postgres storage installs its tables into a dedicated `mochi_queue` schema on first start, away from your application's tables. The schema name is fixed, so every app sharing one database shares one queue namespace — give each app its own database to keep their queues apart.

On durable storage, **declared config is authoritative and storage is a cache of it**. At every boot — `Mochi.serve()`, `Mochi.worker()`, and standalone producers alike — each declared queue is created with its full config if missing, and verified field-by-field against storage if present. A mismatch is a boot error naming the queue, the fields, and both values; an option you leave undeclared is expected to hold its bun-boss default. A declaration with no persisted options at all (`Mochi.queue(name, { storage })`) only asserts the queue exists.

To change a queue's config, change the code — then let one deploy write it through:

```ts
await Mochi.serve({ queues, queueConfig: 'sync' }); // or MOCHI_QUEUE_SYNC=1 in the environment
```

`'sync'` replaces the mismatch error with a repair: the declared config is written to storage and every changed field is logged. `MOCHI_QUEUE_SYNC=1` forces sync process-wide (standalone producers included) and wins over the option — set it on the one deploy that migrates, or leave `queueConfig: 'sync'` on permanently for code-always-wins. The mismatch error also prints a ready-to-paste `Mochi.boss().updateQueue(…)` call for migrating by hand.

<Callout type="warning">

**Share one descriptor across processes.** Every process that declares a queue asserts its config — a producer script declaring different options than the server is a boot error, not a silent divergence. Export the descriptor from one module and import it everywhere. The `queue:expireInSeconds` filter counts as declared config too, so processes must register the same extensions.

</Callout>

### PGlite

`{ pglite: instance }` is the one storage that takes a live instance instead of a config string. Mochi recommends `{ postgres: url }` for production; PGlite — full Postgres compiled to WASM, running in your process with no server — covers dev and test environments while exercising the same Postgres storage path, including the `mochi_queue` schema, so jobs behave the way they will in production:

```ts
import { PGlite } from '@electric-sql/pglite';

const db = await PGlite.create('.db/queue-pglite'); // or PGlite.create() for a throwaway in-memory store

await Mochi.serve({
  queues: [/* … */],
  queueStorage: { pglite: db },
});
```

Passing the instance keeps `@electric-sql/pglite` out of Mochi's dependencies and lets your app share one instance between queue jobs and its own tables. You own the instance, so make sure to close it at shutdown.

### Retries

Failed jobs retry **by default**: `retryLimit` is 2, so a job runs up to 3 times before it fails terminally. Set `retryLimit: 0` for exactly-once execution, and `retryDelay`/`retryBackoff` to space attempts out:

```ts
Mochi.queue('webhooks', {
  process: deliverWebhook,
  retryLimit: 5,
  retryDelay: 5, // seconds; with retryBackoff it doubles per attempt, with jitter
  retryBackoff: true,
  retryDelayMax: 300,
});
```

`job.attempt` in `process` is 1-based, so `job.attempt > retryLimit` is true exactly on the final attempt.

### Dead-letter queues

Point `deadLetter` at another queue and a terminally failed job is copied there — same payload — for handling or inspection, while the original stays `failed` in its source queue as an audit trail. Pass the target's **descriptor** and the reference is self-sufficient: whichever process boots first — server, worker, or a lone producer — creates the target before the queue that points at it, link intact:

```ts
// No `process`: jobs wait here for inspection. Give it one to handle failures automatically.
export const webhooksDlq = Mochi.queue('webhooks-dlq');
export const webhooks = Mochi.queue('webhooks', { process: deliverWebhook, retryLimit: 3, deadLetter: webhooksDlq });

await Mochi.serve({ queues: [webhooks, webhooksDlq] });
```

A descriptor-form target does not need to be in the `queues` array — it is ensured in storage either way, but only mounted (worker started, handle resolvable) where it is declared. The string form (`deadLetter: 'webhooks-dlq'`) still works when the target is declared in the same array or already exists in storage. A dead-letter _loop_ (A→B→A) cannot be created from scratch — each target must exist before its referrer — though an existing loop that matches the declaration passes.

Drain or replay a dead-letter queue through the [escape hatch](#mochiboss): `Mochi.boss().redrive('webhooks-dlq')` moves its jobs back to their source queue.

Removing the link is a config change like any other: delete the option from code and migrate — [`sync`](#storage) clears it, or run the `updateQueue(name, { deadLetter: null })` the mismatch error prints.

<Callout type="info">

**Resetting a queue.** `Mochi.boss().deleteQueue(name)` removes a queue outright — jobs included, pending backlog and failed-job audit trail alike; the next boot recreates it from the declaration. A queue still referenced as another's `deadLetter` cannot be deleted until its referrers are repointed or deleted first.

</Callout>

### Long-running jobs

A job may stay active for `expireInSeconds` (default **900**) before the store assumes the worker died and retries or fails it. Raise it above the **worst-case** runtime of `process`, not the typical one — a job that outlives it is handed out again while the original still runs, firing its side effects twice:

```ts
Mochi.queue('transcode', { process: transcodeVideo, expireInSeconds: 3600 });
```

A deployment can override every queue at once with the [`queue:expireInSeconds`](/docs/extensions/) filter.

### `Mochi.boss()`

Everything Mochi does not wrap — fetching and cancelling jobs, `findJobs`, `redrive`, queue stats — is reachable on the shared [bun-boss](https://github.com/khromov/bun-boss) instance:

```ts
const stats = await Mochi.boss().getQueueStats('emails');
await Mochi.boss().cancel('emails', jobId);
```

It is available from the [`mochi:queuesMounted`](/docs/extensions/#mochiqueuesmounted) hook onwards (or once a standalone producer has connected) and throws before that, or when no queues are declared.

<Callout type="info">

**Queues mount late.** They are created after the `mochi:init` hook and after the server binds, so `Mochi.getQueue()` and `Mochi.boss()` throw if called from `mochi:init`. Add jobs from the `mochi:queuesMounted` hook onwards: the `mochi:ready` hook, or any request handler.

</Callout>

### Observability

Queues emit [events](/docs/events/) on `mochiEvents`: `queue:added`, `queue:addedBulk`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error`. The [console logger](/docs/logging/) prints a `QUEUE` line for `added`, `addedBulk`, `completed`, `failed`, and `error` at `warn`. Wire your own metrics:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('queue:completed', ({ queue, jobId, duration }) => {
  metrics.timing('queue.job', duration, { queue });
});
```

`queue:completed` and `queue:failed` fire per attempt, as the processor settles — an immediate `Mochi.boss().findJobs()` from a listener may still see the job `active` for a beat. An `addBulk` emits `queue:added` per inserted job (flagged `bulk: true`) plus one `queue:addedBulk` summary — the console logger prints only the summary, so a 100k-job bulk add logs one line.

When a queue's backlog crosses the warning threshold (`warningQueueSize`, default `10000`), Mochi logs a `[queue]` warning that names the offending queue and its current depth — e.g. `[queue] Warning: large queue backlog. Your queue should be reviewed (queue "emails" has 12345 jobs queued)`.

### Dev mode & hot reload

`Mochi.serve({ queues })` starts the queue runtime once, so the dev route hot-reload watcher cannot spawn a duplicate consumer. The trade-off: **changes to a queue's `process` function or options do not hot-reload**. Restart the dev server to apply them.

### Shutdown

Queues close gracefully on `SIGTERM`/`SIGINT`. In-flight jobs get up to `queueShutdownTimeout` (default 10 seconds) to finish; a job still running after that is failed and follows its queue's retry policy from the store. Raise it for handlers that legitimately run longer than 10s, so a job in flight at shutdown finishes instead of being re-run:

```ts
Mochi.serve({ queues, queueShutdownTimeout: 60_000 }); // or Mochi.worker({ queues, queueShutdownTimeout })
```

<VersionNote since="0.10.0" message="queueShutdownTimeout was added in 0.10.0; before it, the queue graceful-drain window was fixed at 10s." />

It is distinct from `shutdownTimeout`, which bounds the HTTP-server drain. For a worker process with an HTTP port (health checks, metrics), use `Mochi.serve({ queues })` with no `routes` — [`Mochi.worker()`](#standalone-workers) is the serverless alternative:

```ts
// worker.ts — run with `bun worker.ts`
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  queueStorage: { postgres: process.env.DATABASE_URL },
  queues: [
    Mochi.queue('emails', {
      process: async (job) => {
        await sendEmail(job.data.to);
      },
    }),
  ],
});
```

<Callout type="info">

**Dispatch is instant in-process, polled across processes.** An `add()` from the serving process wakes its worker immediately. Other processes sharing Postgres storage — and deferred or retried jobs everywhere — are picked up on the worker's poll, every `pollingIntervalSeconds` (default 2, minimum 0.5).

</Callout>

### `Mochi.stop()`

`Mochi.stop()` runs the same graceful teardown as `SIGTERM`/`SIGINT` — the `mochi:shutdown` hook, queue drain, server stop — without exiting the process, so a finite-lifetime script or test ends naturally. In a [standalone producer](#standalone-producers) process it closes the queue runtime. It is idempotent, and a stopped process cannot `Mochi.serve()` again.

```ts
await Mochi.serve({ routes, queues });
// … later, from a test or an embedding script:
await Mochi.stop();
```

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with queues", hook: "How background job queues work — offload work to a Mochi.queue() with an embedded worker, no Redis." }]}
/>
