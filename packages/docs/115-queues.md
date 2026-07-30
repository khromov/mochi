---
title: 'Queues'
slug: queues
description: 'Run background jobs in-process with Mochi.queue(), backed by bunqueue embedded mode.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Queues

Offload work that should not block a response — sending email, encoding media, calling slow APIs — to a background **queue**. A queue bundles a job channel with the `process` function that consumes it. Both run in your process, backed by [bunqueue](https://bunqueue.dev/) in embedded mode.

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
await Mochi.getQueue<{ to: string }>('emails').add('send', { to: 'alice@example.com' });
```

### `Mochi.queue()`

```ts
const queueConfig = Mochi.queue<JobData, Result>({ process, ...options });
```

The required `process` function receives a read-only `MochiJob<T>` and returns the job result:

| Field        | Type     | Notes                                   |
| ------------ | -------- | --------------------------------------- |
| `id`         | `string` | job id                                  |
| `name`       | `string` | job name passed to `add()`              |
| `data`       | `T`      | the enqueued payload                    |
| `queue`      | `string` | queue name                              |
| `attempt`    | `number` | 1-based attempt number (1 on first run) |
| `enqueuedAt` | `number` | epoch ms when enqueued                  |

Options: `concurrency`, `dataPath`, `lockDuration`, `recover`, and `on` for lifecycle listeners:

```ts
Mochi.queue({
  concurrency: 10,
  process,
  on: {
    completed: (job, result) => log.info(`${job.name} done`),
    failed: (job, error) => log.warn(`${job.name} failed: ${error.message}`),
  },
});
```

Or subscribe on the [`mochiEvents` bus](#observability) (filter by `queue` name) when the listener lives far from the queue declaration.

### `Mochi.getQueue()`

`Mochi.getQueue<JobData>(name)` resolves a mounted queue's handle. Call `.add()` on it to add jobs. Pass the payload type explicitly. It throws if the name was never declared in `Mochi.serve({ queues })`, or if reached before `Mochi.serve()` mounted its queues.

| Method                   | Returns                  | Notes                    |
| ------------------------ | ------------------------ | ------------------------ |
| `add(name, data, opts?)` | `Promise<MochiJobRef>`   | enqueue one job          |
| `addBulk(jobs)`          | `Promise<MochiJobRef[]>` | enqueue many in one call |

`MochiJobRef` is `{ id, name }`. Per-job options: `priority`, `delay` (ms), `attempts`, `jobId`.

```ts
const emails = Mochi.getQueue<{ to: string }>('emails');
await emails.add('send', { to: 'bob@example.com' }, { priority: 10, delay: 5000 });
await emails.addBulk([
  { name: 'send', data: { to: 'a@x.com' } },
  { name: 'send', data: { to: 'b@x.com' }, opts: { priority: 10 } },
]);
```

### A shared queue module

Export the queue config from a shared module so your entry can mount it, while route code adds jobs by name.

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
// index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';
import { emailQueue } from './jobs.server';

await Mochi.serve({
  routes,
  queues: { emails: emailQueue },
});
```

### Persistence

The queue is **in-memory** by default, so jobs do not survive a restart. Pass `dataPath` to persist to SQLite:

```ts
Mochi.queue({ process, dataPath: '.mochi/queue.sqlite' });
```

<Callout type="warning">

bunqueue locks the persisted store to the **first** `dataPath` used in the process. Use one `dataPath` across all your queues. Mochi logs a warning and ignores a conflicting path.

</Callout>

### Long-running jobs

A job holds a lock while it runs. If the job outlives the lock, the queue assumes the worker died and hands the job to another worker while the original still runs. The default lock is **30 minutes**, which is also the longest a job may run. Lower it with `lockDuration` (ms) to reclaim a stuck job sooner:

```ts
Mochi.queue({ process: resizeImage, lockDuration: 60_000 });
```

<Callout type="warning">

`lockDuration` must exceed the **worst-case** runtime of `process`, not the typical one. A job that overruns is re-queued mid-flight. Its eventual success is rejected as `Invalid or expired lock token` and reported as a failure, even though the work succeeded.

</Callout>

<Callout type="danger">

**30 minutes is a ceiling, not just a default.** The queue drops any job that runs longer, whatever `lockDuration` says. Work that can run longer belongs outside the queue, or split into jobs that each finish well inside the limit.

</Callout>

### Recovery on start

An in-memory queue loses its jobs on restart. Even a persisted one cannot know about work your own database recorded before the job was accepted. `recover` runs once at startup, after every queue mounts, with this queue's handle. Use it to add back whatever your store still considers unfinished:

```ts
Mochi.queue<{ id: number }>({
  process: sendEmail,
  recover: async (queue) => {
    // Rows your app marked unsent are the source of truth, not the queue.
    await queue.addBulk(pendingEmailIds().map((id) => ({ name: 'send', data: { id } })));
  },
});
```

Recovery is awaited before `Mochi.serve()` resolves. A throw is contained: Mochi logs it, emits `queue:error`, and the server keeps running. Mochi logs a warning if a `recover` callback is still running after 30 seconds.

<Callout type="info">

**Queues mount late.** They are created after the `mochi:init` hook and after the server binds, so `Mochi.getQueue()` throws if you call it from `mochi:init`. Add jobs from the [`mochi:queuesMounted`](/docs/extensions/#mochiqueuesmounted) hook onwards: a queue's own `recover`, the `mochi:ready` hook, or any request handler.

</Callout>

### Advanced options

Mochi surfaces a small, stable set of first-class options. For bunqueue features Mochi does not surface — retry backoff, rate limiting, cron/repeat, dead-letter queue, deduplication — pass a `bunqueue` object forwarded verbatim to the underlying queue and worker:

```ts
const apiCalls = Mochi.queue({
  process,
  defaultJobOptions: { attempts: 5 },
  bunqueue: { limiter: { max: 100, duration: 1000 } },
});

await Mochi.getQueue('api-calls').add('call', data, {
  attempts: 5,
  bunqueue: { backoff: { type: 'jitter', delay: 1000 } },
});
```

See the [bunqueue docs](https://bunqueue.dev/guide/simple-mode/) for the full option set.

<Callout type="info">

`bunqueue` is applied last, so anything it repeats wins over the first-class option next to it. Prefer the first-class option where one exists. The exception is `lockDuration`, which the [`queue:lockDurationMs`](/docs/extensions/) filter always has the final say on.

</Callout>

### Observability

Queues emit [events](/docs/events/) on `mochiEvents`: `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error`. The [console logger](/docs/logging/) prints a `QUEUE` line for `added`, `completed`, `failed`, and `error` at `warn`. Wire your own metrics:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('queue:completed', ({ queue, jobName, duration }) => {
  metrics.timing('queue.job', duration, { queue, job: jobName });
});
```

### Dev mode & hot reload

`Mochi.serve({ queues })` instantiates a queue once, so the dev route hot-reload watcher cannot spawn a duplicate consumer. The trade-off: **changes to a queue's `process` function or options do not hot-reload**. Restart the dev server to apply them.

### Shutdown

Queues close gracefully on `SIGTERM`/`SIGINT`. In-flight jobs drain before the process exits. A queue-only process is `Mochi.serve({ queues })` with no `routes`:

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

**Embedded mode only.** The code that adds jobs and the worker that runs them share one process. bunqueue also supports a TCP server mode for distributed workers, but Mochi does not expose that yet.

</Callout>

### Dependencies

New `create-mochi` projects ship a `package.json` `overrides` entry that keeps bunqueue's install free of platform-specific native binaries. To use the native bindings instead, delete that `overrides` entry.

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with queues", hook: "How background job queues work — offload work to a Mochi.queue() with an embedded worker, no Redis." }]}
/>
