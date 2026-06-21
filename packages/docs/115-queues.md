---
title: 'Queues & workers'
slug: queues
description: 'Run background jobs in-process with Mochi.queue() and Mochi.worker(), backed by bunqueue embedded mode.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Queues & workers

Offload work that shouldn't block a response — sending email, encoding media, calling slow third-party APIs — to a background **worker**. `Mochi.queue()` is the producer; `Mochi.worker()` is the consumer. Both run in your process, backed by [bunqueue](https://bunqueue.dev/)'s embedded mode. No Redis, no separate service.

Unlike `Mochi.page` / `api` / `ws` / `sse`, these don't return route configs for `Mochi.serve()` — they return **live handles**. Create them at module top-level and use them anywhere.

```ts
import { Mochi } from 'mochi-framework';

const emails = Mochi.queue<{ to: string }>('emails');

Mochi.worker<{ to: string }>('emails', async (job) => {
  await sendEmail(job.data.to);
  return { sent: true };
});

// from a page action, an API route, anywhere:
await emails.add('send', { to: 'alice@example.com' });
```

### `Mochi.queue()`

```ts
const queue = Mochi.queue<JobData>(name, options?);
```

| Method                   | Returns                  | Notes                                |
| ------------------------ | ------------------------ | ------------------------------------ |
| `add(name, data, opts?)` | `Promise<MochiJobRef>`   | enqueue one job                      |
| `addBulk(jobs)`          | `Promise<MochiJobRef[]>` | enqueue many in one call             |
| `close()`                | `Promise<void>`          | stop the producer (auto on shutdown) |

`MochiJobRef` is `{ id, name }`. Per-job options: `priority`, `delay` (ms), `attempts`, `jobId`.

```ts
await queue.add('send', { to: 'bob@example.com' }, { priority: 10, delay: 5000 });
await queue.addBulk([
  { name: 'send', data: { to: 'a@x.com' } },
  { name: 'send', data: { to: 'b@x.com' }, opts: { priority: 10 } },
]);
```

### `Mochi.worker()`

```ts
const worker = Mochi.worker<JobData, Result>(name, processor, options?);
```

The processor receives a read-only `MochiJob<T>` and returns the job result:

| Field        | Type     | Notes                                   |
| ------------ | -------- | --------------------------------------- |
| `id`         | `string` | job id                                  |
| `name`       | `string` | job name passed to `add()`              |
| `data`       | `T`      | the enqueued payload                    |
| `queue`      | `string` | queue name                              |
| `attempt`    | `number` | 1-based attempt number (1 on first run) |
| `enqueuedAt` | `number` | epoch ms when enqueued                  |

Options: `concurrency` (jobs processed at once), `dataPath` (see below). Subscribe to outcomes on the handle:

```ts
const worker = Mochi.worker('emails', processor, { concurrency: 10 });

worker.on('completed', (job, result) => log.info(`${job.name} done`));
worker.on('failed', (job, error) => log.warn(`${job.name} failed: ${error.message}`));
```

### Producer + consumer in one module

The common pattern is a shared module: define the queue and worker together, export the queue so route code can `.add()` to it.

```ts
// jobs.ts
import { Mochi } from 'mochi-framework';

export const emails = Mochi.queue<{ to: string }>('emails');

Mochi.worker<{ to: string }>('emails', async (job) => {
  await sendEmail(job.data.to);
  return { sent: true };
});
```

```ts
// routes.ts
import { Mochi, success } from 'mochi-framework';
import { emails } from './jobs';

export const routes = {
  '/signup': Mochi.page('./Signup.svelte', {
    actions: {
      register: async ({ request }) => {
        const data = await request.formData();
        await emails.add('send', { to: String(data.get('email')) });
        return success({ ok: true });
      },
    },
  }),
};
```

<Callout type="info">

Importing `jobs.ts` is what starts the worker. Make sure something in your server's import graph reaches it — importing it from `routes.ts` (as above) is enough.

</Callout>

### Persistence

By default the queue is **in-memory** — jobs do not survive a restart. Pass `dataPath` to persist to SQLite:

```ts
const queue = Mochi.queue('emails', { dataPath: '.mochi/queue.sqlite' });
Mochi.worker('emails', processor, { dataPath: '.mochi/queue.sqlite' });
```

<Callout type="warning">

bunqueue locks the embedded store to the **first** `dataPath` used in the process. Use one `dataPath` across all your queues and workers; conflicting paths are ignored (Mochi logs a warning).

</Callout>

### Advanced options

Mochi wraps a small, stable core. For bunqueue features Mochi doesn't surface first-class — retry backoff, rate limiting, cron/repeat, dead-letter queue, deduplication — pass a `bunqueue` object that is forwarded verbatim:

```ts
const queue = Mochi.queue('api-calls', {
  bunqueue: { defaultJobOptions: { backoff: { type: 'exponential', delay: 1000 } } },
});

Mochi.worker('api-calls', processor, {
  bunqueue: { limiter: { max: 100, duration: 1000 } },
});

await queue.add('call', data, { attempts: 5, bunqueue: { backoff: { type: 'jitter', delay: 1000 } } });
```

See the [bunqueue docs](https://bunqueue.dev/guide/simple-mode/) for the full option set.

### Observability

Workers emit [events](/docs/events/) on the `mochiEvents` bus — `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error` — and the built-in [console logger](/docs/logging/) prints a `QUEUE` line per job. Wire your own metrics directly:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('queue:completed', ({ queue, jobName, duration }) => {
  metrics.timing('queue.job', duration, { queue, job: jobName });
});
```

### Dev mode & hot reload

`Mochi.worker()` is **idempotent per queue name**: only one worker runs for a given name in a process. In dev, the route hot-reload watcher re-runs your modules (including the one that calls `Mochi.worker()`), but the framework keeps the first worker and logs a one-time warning instead of starting a duplicate.

The trade-off: **changes to a worker's processor or options don't hot-reload** — restart the dev server to apply them. The same idempotency means you can keep ordinary in-memory state (a results buffer, a counter) in module scope without it being duplicated.

<Callout type="info">

This applies to the worker. A long-running resource the worker _opens_ (a DB pool, a client connection) is your own singleton — if it must survive the dev module re-run, pin it to `globalThis` the way the framework pins its own internals.

</Callout>

### Shutdown

Queues and workers close gracefully when `Mochi.serve()` receives `SIGTERM`/`SIGINT` — in-flight jobs drain before the process exits. This works even for a **standalone worker process** that never calls `Mochi.serve()`: creating a worker installs the same signal handlers.

```ts
// worker.ts — run with `bun worker.ts`, no HTTP server
import { Mochi } from 'mochi-framework';

Mochi.worker('emails', async (job) => {
  await sendEmail(job.data.to);
});
```

<Callout type="info">

**Embedded mode only.** Producer and consumer share one process. bunqueue also supports a TCP server mode for distributed workers; Mochi doesn't expose that yet.

</Callout>

### Dependencies

Mochi uses bunqueue as the underlying implementation for queues and workers. To keep the dependency count low, Mochi skips the optional native add-on that bunqueue would otherwise pull in, so it and its platform-specific binaries never land in your install.
