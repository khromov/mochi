---
title: 'Queues'
slug: queues
description: 'Run background jobs with Mochi.queue(), backed by bun-boss on memory, SQLite, or Postgres storage.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Queues

Offload work that should not block a response — sending email, encoding media, calling slow APIs — to a background **queue**. A queue bundles a job channel with the `process` function that consumes it. Both run in your process, backed by [bun-boss](https://github.com/khromov/bun-boss).

`Mochi.queue()` returns an inert config. Mount it in `Mochi.serve({ queues })`, keyed by name, so every background queue the server runs is declared in one place. Add jobs from anywhere with `Mochi.getQueue(name).add(...)`.

```ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {/* … */},
  queues: {
    // the map key is the queue name
    emails: Mochi.queue<{ to: string }>({
      concurrency: 10,
      process: async (job) => {
        await sendEmail(job.data.to);
        return { sent: true };
      },
    }),
  },
});

// from a page action, an API route, anywhere:
await Mochi.getQueue<{ to: string }>('emails').add({ to: 'alice@example.com' });
```

### `Mochi.queue()`

```ts
const queueConfig = Mochi.queue<JobData, Result>({ process, ...options });
```

`process` receives a read-only `MochiJob<T>` and returns the job result. Omit it for a queue that only receives jobs — e.g. a [dead-letter](#dead-letter-queues) holding pen.

| Field        | Type     | Notes                                   |
| ------------ | -------- | --------------------------------------- |
| `id`         | `string` | job id                                  |
| `data`       | `T`      | the enqueued payload                    |
| `queue`      | `string` | queue name                              |
| `attempt`    | `number` | 1-based attempt number (1 on first run) |
| `enqueuedAt` | `number` | epoch ms when enqueued                  |

Queue-level options are inherited by every job: `concurrency`, `pollingIntervalSeconds`, [retries](#retries) (`retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`), `expireInSeconds`, `retentionSeconds`, `deleteAfterSeconds`, `deadLetter`. Every duration is in **seconds**. `on` registers lifecycle listeners:

```ts
Mochi.queue({
  concurrency: 10,
  process,
  on: {
    completed: (job, result) => log.info(`${job.id} done`),
    failed: (job, error) => log.warn(`${job.id} failed: ${error.message}`),
  },
});
```

Or subscribe on the [`mochiEvents` bus](#observability) (filter by `queue` name) when the listener lives far from the queue declaration.

### `Mochi.getQueue()`

`Mochi.getQueue<JobData>(name)` resolves a mounted queue's handle. Call `.add()` on it to add jobs. Pass the payload type explicitly. It throws if the name was never declared in `Mochi.serve({ queues })`, or if reached before `Mochi.serve()` mounted its queues.

| Method                                     | Returns                   | Notes                                       |
| ------------------------------------------ | ------------------------- | ------------------------------------------- |
| `add(data, opts?)`                         | `Promise<string \| null>` | enqueue one job, resolves its id            |
| `addBulk(jobs)`                            | `Promise<string[]>`       | enqueue many in one call                    |
| `addThrottled(data, seconds, key?, opts?)` | `Promise<string \| null>` | at most one job per `seconds` slot per key  |
| `addDebounced(data, seconds, key?, opts?)` | `Promise<string \| null>` | like throttled, but books the next slot too |

Per-job options override their queue-level counterparts: `priority`, `startAfter` (seconds, or a `Date`), `id`, `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`, `expireInSeconds`.

```ts
const emails = Mochi.getQueue<{ to: string }>('emails');
await emails.add({ to: 'bob@example.com' }, { priority: 10, startAfter: 5 });
await emails.addBulk([{ data: { to: 'a@x.com' } }, { data: { to: 'b@x.com' }, opts: { priority: 10 } }]);
```

<Callout type="info">

**`add()` can resolve `null`.** Passing an explicit `id` makes the add idempotent — a second add with the same id resolves `null` instead of duplicating the job. Throttled and debounced adds resolve `null` when the slot is already taken. A plain `add()` always resolves an id.

</Callout>

### Storage

One store serves every queue in the map, selected by the serve-level `queueStorage` option:

```ts
await Mochi.serve({
  queues: {/* … */},
  queueStorage: 'memory', // the default
  // queueStorage: { sqlite: '.db/queue.sqlite' },
  // queueStorage: { postgres: process.env.DATABASE_URL },
});
```

| Storage             | Survives restarts | Scope                                            |
| ------------------- | ----------------- | ------------------------------------------------ |
| `'memory'`          | no                | single process                                   |
| `{ sqlite: path }`  | yes               | single process, one durable file                 |
| `{ postgres: url }` | yes               | shared — multiple processes can work one backlog |

Postgres storage installs its tables into a dedicated `mochi_queue` schema on first start, away from your application's tables.

<Callout type="warning">

SQLite storage is **fresh-install only** for now: upgrading to a bun-boss release with a newer schema against an existing file throws at startup until SQLite migrations ship upstream. Delete the file (losing queued jobs) or drain it first.

</Callout>

### Retries

Failed jobs retry **by default**: `retryLimit` is 2, so a job runs up to 3 times before it fails terminally. Set `retryLimit: 0` for exactly-once execution, and `retryDelay`/`retryBackoff` to space attempts out:

```ts
Mochi.queue({
  process: deliverWebhook,
  retryLimit: 5,
  retryDelay: 5, // seconds; with retryBackoff it doubles per attempt, with jitter
  retryBackoff: true,
  retryDelayMax: 300,
});
```

`job.attempt` in `process` is 1-based, so `job.attempt > retryLimit` is true exactly on the final attempt.

### Dead-letter queues

Point `deadLetter` at another queue in the same map and terminally failed jobs move there — same payload — instead of parking in the failed state:

```ts
await Mochi.serve({
  queues: {
    webhooks: Mochi.queue({ process: deliverWebhook, retryLimit: 3, deadLetter: 'webhooks-dlq' }),
    // No `process`: jobs wait here for inspection. Give it one to handle failures automatically.
    'webhooks-dlq': Mochi.queue({}),
  },
});
```

Drain or replay a dead-letter queue through the [escape hatch](#mochiboss): `Mochi.boss().redrive('webhooks-dlq')` moves its jobs back to their source queue.

### Long-running jobs

A job may stay active for `expireInSeconds` (default **900**) before the store assumes the worker died and retries or fails it. Raise it above the **worst-case** runtime of `process`, not the typical one — a job that outlives it is handed out again while the original still runs, firing its side effects twice:

```ts
Mochi.queue({ process: transcodeVideo, expireInSeconds: 3600 });
```

A deployment can override every queue at once with the [`queue:expireInSeconds`](/docs/extensions/) filter.

### `Mochi.boss()`

Everything Mochi does not wrap — fetching and cancelling jobs, `findJobs`, `redrive`, queue stats — is reachable on the shared [bun-boss](https://github.com/khromov/bun-boss) instance:

```ts
const stats = await Mochi.boss().getQueueStats('emails');
await Mochi.boss().cancel('emails', jobId);
```

It is available from the [`mochi:queuesMounted`](/docs/extensions/#mochiqueuesmounted) hook onwards and throws before that, or when no queues are declared.

<Callout type="info">

**Queues mount late.** They are created after the `mochi:init` hook and after the server binds, so `Mochi.getQueue()` and `Mochi.boss()` throw if called from `mochi:init`. Add jobs from the `mochi:queuesMounted` hook onwards: the `mochi:ready` hook, or any request handler.

</Callout>

### Observability

Queues emit [events](/docs/events/) on `mochiEvents`: `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error`. The [console logger](/docs/logging/) prints a `QUEUE` line for `added`, `completed`, `failed`, and `error` at `warn`. Wire your own metrics:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('queue:completed', ({ queue, jobId, duration }) => {
  metrics.timing('queue.job', duration, { queue });
});
```

`queue:completed` and `queue:failed` fire per attempt, as the processor settles — an immediate `Mochi.boss().findJobs()` from a listener may still see the job `active` for a beat.

### Dev mode & hot reload

`Mochi.serve({ queues })` starts the queue runtime once, so the dev route hot-reload watcher cannot spawn a duplicate consumer. The trade-off: **changes to a queue's `process` function or options do not hot-reload**. Restart the dev server to apply them.

### Shutdown

Queues close gracefully on `SIGTERM`/`SIGINT`. In-flight jobs drain before the process exits. A queue-only process is `Mochi.serve({ queues })` with no `routes`:

```ts
// worker.ts — run with `bun worker.ts`
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  queueStorage: { postgres: process.env.DATABASE_URL },
  queues: {
    emails: Mochi.queue({
      process: async (job) => {
        await sendEmail(job.data.to);
      },
    }),
  },
});
```

<Callout type="info">

**Dispatch is instant in-process, polled across processes.** An `add()` from the serving process wakes its worker immediately. Other processes sharing Postgres storage — and deferred or retried jobs everywhere — are picked up on the worker's poll, every `pollingIntervalSeconds` (default 2, minimum 0.5).

</Callout>

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with queues", hook: "How background job queues work — offload work to a Mochi.queue() with an embedded worker, no Redis." }]}
/>
