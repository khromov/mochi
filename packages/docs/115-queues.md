---
title: 'Queues'
slug: queues
description: 'Run background jobs in-process with Mochi.queue(), backed by better-queue with memory, SQLite, or Postgres storage.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Queues

Offload work that shouldn't block a response — sending email, encoding media, calling slow third-party APIs — to a background **queue**. A queue bundles a job channel with the `process` function that consumes it; both run in your process, backed by [better-queue](https://github.com/diamondio/better-queue) with a Mochi-provided storage layer: in-memory (default), SQLite, or Postgres.

`Mochi.queue()` — like `Mochi.page` / `api` / `ws` / `sse` — returns an **inert config** that you mount in `Mochi.serve({ queues })`, keyed by name, so every background queue the server runs is declared in one place. Push jobs from anywhere with `Mochi.getQueue(name).push(...)`.

```ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {/* … */},
  queues: {
    // the map key is the queue name
    emails: Mochi.queue<{ to: string }>({
      concurrent: 10,
      process: async (job) => {
        await sendEmail(job.data.to);
        return { sent: true };
      },
    }),
  },
});

// from a page action, an API route, anywhere:
await Mochi.getQueue<{ to: string }>('emails').push({ to: 'alice@example.com' });
```

### `Mochi.queue()`

```ts
const queueConfig = Mochi.queue<JobData, Result>({ process, ...options });
```

`Mochi.queue()` returns an inert config — mount it under the queue name in `Mochi.serve({ queues })`. The required `process` function receives a read-only `MochiJob<T>` and returns the job result:

| Field        | Type     | Notes                                   |
| ------------ | -------- | --------------------------------------- |
| `id`         | `string` | job id (set at `push()`)                |
| `data`       | `T`      | the enqueued payload                    |
| `queue`      | `string` | queue name                              |
| `attempt`    | `number` | 1-based attempt number (1 on first run) |
| `enqueuedAt` | `number` | epoch ms when enqueued                  |

Options use better-queue's own names — `concurrent` (jobs processed at once), `maxRetries` / `retryDelay` (see [Retries & timeouts](#retries--timeouts)), `store` (see [Storage](#storage)), `filo`, `batchSize`, `precondition`, `cancelIfRunning`, `autoResume`, and more — plus `recover` (a startup callback for re-enqueuing unfinished work, see [Recovery on start](#recovery-on-start)) and `on` for lifecycle listeners:

```ts
Mochi.queue({
  concurrent: 10,
  process,
  on: {
    completed: (job, result) => log.info(`${job.id} done`),
    failed: (job, error) => log.warn(`${job.id} failed: ${error.message}`),
  },
});
```

The `filter`, `merge`, `priority`, and `id` callbacks operate directly on your payload:

```ts
Mochi.queue<{ userId: string; count: number }>({
  process,
  // Dedupe key: pushes for the same user merge instead of piling up.
  id: (data) => data.userId,
  merge: (oldData, newData, cb) => cb(null, { ...newData, count: oldData.count + newData.count }),
  priority: (data, cb) => cb(null, data.count),
});
```

Or subscribe globally on the [`mochiEvents` bus](#observability) (filter by `queue` name) — handy when the listener lives far from the queue declaration.

### `Mochi.getQueue()`

`Mochi.getQueue<JobData>(name)` resolves a mounted queue's handle — call `.push()` on it to add jobs. Pass the payload type explicitly. It throws if the name was never declared in `Mochi.serve({ queues })`, or if reached before `Mochi.serve()` mounted its queues — the message tells you which, so a mistimed call is never reported as a misspelled name.

| Method              | Returns                | Notes                                      |
| ------------------- | ---------------------- | ------------------------------------------ |
| `push(data, opts?)` | `Promise<MochiJobRef>` | enqueue one job; resolves once it's queued |
| `pause()`           | `void`                 | stop processing (jobs still accumulate)    |
| `resume()`          | `void`                 | resume processing                          |
| `getStats()`        | stats object           | `{ total, average, successRate, peak }`    |

`MochiJobRef` is `{ id }`. The only per-push option is `id` — pushing an id that is already queued **merges** with the queued job (see the `merge` option) instead of enqueueing a duplicate:

```ts
const emails = Mochi.getQueue<{ to: string }>('emails');
await emails.push({ to: 'bob@example.com' });
await emails.push({ to: 'carol@example.com' }, { id: `signup-${userId}` });
// bulk is just Promise.all:
await Promise.all(addresses.map((to) => emails.push({ to })));
```

### A shared queue module

The common pattern is a shared module that exports the queue config (so your entry can mount it) while route code pushes jobs by name.

```ts
// jobs.server.ts
import { Mochi } from 'mochi-framework';

export const emailQueue = Mochi.queue<{ to: string }>({
  process: async (job) => {
    await sendEmail(job.data.to);
    return { sent: true };
  },
});
```

```ts
// routes.ts
import { Mochi, success } from 'mochi-framework';

export const routes = {
  '/signup': Mochi.page('./Signup.svelte', {
    actions: {
      register: async ({ request }) => {
        const data = await request.formData();
        await Mochi.getQueue<{ to: string }>('emails').push({ to: String(data.get('email')) });
        return success({ ok: true });
      },
    },
  }),
};
```

```ts
// index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';
import { emailQueue } from './jobs.server';

await Mochi.serve({
  routes,
  queues: { emails: emailQueue },
});
```

### Storage

By default the queue is **in-memory** — jobs do not survive a restart. Pass `store` to persist to SQLite (via `bun:sqlite`) or Postgres (via `Bun.sql`):

```ts
Mochi.queue({ process, store: { type: 'sqlite', path: '.mochi/queue.sqlite' } });

Mochi.queue({ process, store: { type: 'postgres', url: process.env.DATABASE_URL } });
// or omit `url` to let Bun.SQL read DATABASE_URL/POSTGRES_URL itself,
// or hand over an existing pool: { type: 'postgres', sql: mySql }
```

All queues can share one file or database — rows carry the queue name, in one table (`mochi_queue_tasks`; override per queue with `tableName`). Payloads are stored as JSON, so they must be JSON-serializable.

With a persistent store, jobs a previous process left queued — or died holding mid-run — are picked up automatically on the next boot (`autoResume`, on by default).

For anything else, `store` also accepts a custom instance implementing better-queue's store interface (`MochiBetterQueueStore`).

### Retries & timeouts

Retries are configured per queue: `maxRetries` is the **total attempt budget** for a job, and `retryDelay` the fixed pause (ms) before each retry. The processor's `job.attempt` tells you which attempt is running:

```ts
Mochi.queue({
  process,
  maxRetries: 3, // a job runs at most 3 times
  retryDelay: 5000, // 5s between attempts
});
```

`queue:failed` (and the `on.failed` listener) fire **once per job, terminally** — after the last attempt fails. Intermediate failures retry silently.

`maxTimeout` (ms) fails a job that runs too long — there is no timeout by default. Deployments can cap it for every queue at once with the [`queue:maxTimeoutMs`](/docs/extensions/) filter.

```ts
Mochi.queue({ process: resizeImage, maxTimeout: 60_000 });
```

### Recovery on start

An in-memory queue loses its jobs on restart, and even a persisted one can't know about work your own database recorded before the job was accepted. `recover` runs once at startup — after every queue in `Mochi.serve({ queues })` is mounted — with this queue's handle, so it's the place to add back whatever your store still considers unfinished:

```ts
Mochi.queue<{ id: number }>({
  process: sendEmail,
  recover: async (queue) => {
    // Rows your app marked unsent are the source of truth, not the queue.
    await Promise.all(pendingEmailIds().map((id) => queue.push({ id })));
  },
});
```

Recovery is awaited before `Mochi.serve()` resolves, so recovered jobs are enqueued before the `mochi:ready` hook fires. Because the server is already bound and serving by then, a throw is contained: Mochi logs it and emits `queue:error`, and the server keeps running.

A `recover` that never settles is never cut short — abandoning it would drop the jobs it was about to add. Since warmup, `mochi:ready` and `serve()` resolving all wait behind it, Mochi logs a warning naming the queue if one is still running after 30 seconds.

<Callout type="info">

**`recover` and `autoResume` are complementary.** A persistent store's `autoResume` re-runs jobs the queue itself still holds, at mount time — before `recover` runs. `recover` is for work only _your_ database knows about. Pushing an id that `autoResume` already re-queued merges rather than duplicating, if your ids are stable.

</Callout>

<Callout type="info">

**Queues mount late.** They are created after the `mochi:init` hook and after the server binds, so `Mochi.getQueue()` throws if you call it from `mochi:init` — the error says as much. Anywhere from the [`mochi:queuesMounted`](/docs/extensions/#mochiqueuesmounted) hook onwards can add jobs: a queue's own `recover` callback, the `mochi:ready` hook, or any request handler.

</Callout>

### Advanced options

Mochi surfaces better-queue's options first-class, typed. For anything else — or to override what Mochi computes — pass a `betterQueue` object that is forwarded verbatim to the better-queue constructor:

```ts
const apiCalls = Mochi.queue({
  process,
  maxRetries: 5,
  betterQueue: { afterProcessDelay: 250 },
});
```

See the [better-queue readme](https://github.com/diamondio/better-queue#full-documentation) for the full option set.

<Callout type="warning">

`betterQueue` is applied last, so anything it repeats wins over the first-class option next to it — prefer the first-class option where one exists. Two caveats: `maxTimeout` set either way still goes through the [`queue:maxTimeoutMs`](/docs/extensions/) filter, which has the final say; and overriding `id` or `store` through `betterQueue` bypasses the task envelope Mochi wraps around your payload — expert-only.

</Callout>

### Observability

Queues emit [events](/docs/events/) on the `mochiEvents` bus — `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error` — and the built-in [console logger](/docs/logging/) prints a `QUEUE` line for `added`, `completed`, `failed`, and `error`. Those four print at `warn`, so they're visible under the production default level; demote them with the [`consoleLogger:level` filter](/docs/extensions/) if you don't want them there. The per-attempt `active` line needs `logger: { level: 'debug' }`. Wire your own metrics directly:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('queue:completed', ({ queue, jobId, duration }) => {
  metrics.timing('queue.job', duration, { queue });
});
```

### Dev mode & hot reload

A queue is instantiated **once**, by `Mochi.serve({ queues })` — `Mochi.queue()` itself is just inert config, so the dev route hot-reload watcher re-running your modules can't spawn a duplicate consumer.

The trade-off: **changes to a queue's `process` function or options don't hot-reload** — restart the dev server to apply them. Because the queue module is imported once, you can keep ordinary in-memory state (a results buffer, a counter) in module scope without it being duplicated.

<Callout type="info">

A long-running resource the `process` function _opens_ (a DB pool, a client connection) is your own singleton — if it must survive a dev module re-run, pin it to `globalThis` the way the framework pins its own internals.

</Callout>

### Shutdown

Queues close gracefully when `Mochi.serve()` receives `SIGTERM`/`SIGINT` — processing stops and each store closes; with a persistent store, whatever was still queued is picked back up on the next boot. A **queue-only process** (no page/API routes) is just `Mochi.serve({ queues })` with no `routes`:

```ts
// worker.ts — run with `bun worker.ts`
import { Mochi } from 'mochi-framework';

await Mochi.serve({
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

**One process.** The code that pushes jobs and the `process` function that runs them share the process. The Postgres store gives multiple processes a shared backlog (claims use `FOR UPDATE SKIP LOCKED`), but `recover` still assumes a single instance — see [Recovery on start](#recovery-on-start).

</Callout>

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with queues", hook: "How background job queues work — offload work to a Mochi.queue() with an in-process consumer, no Redis." }]}
/>
