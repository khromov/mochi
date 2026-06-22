---
title: 'Queues & workers'
slug: queues
description: 'Run background jobs in-process with Mochi.queue() and Mochi.worker(), backed by bunqueue embedded mode.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Queues & workers

Offload work that shouldn't block a response — sending email, encoding media, calling slow third-party APIs — to a background **worker**. `Mochi.worker()` is the consumer; `Mochi.queue()` is the producer. Both run in your process, backed by [bunqueue](https://bunqueue.dev/)'s embedded mode.

`Mochi.worker()` — like `Mochi.page` / `api` / `ws` / `sse` — returns an **inert config** that you mount in `Mochi.serve({ workers })`, keyed by queue name, so every background worker the server runs is declared in one place. `Mochi.queue()` is different: it returns a **live handle** — create it at module top-level and `.add()` to it from anywhere.

```ts
import { Mochi } from 'mochi-framework';

// producer — a live handle you import and `.add()` to
export const emails = Mochi.queue<{ to: string }>('emails');

await Mochi.serve({
  routes: {
    /* … */
  },
  workers: {
    // the map key is the queue name
    emails: Mochi.worker<{ to: string }>(async (job) => {
      await sendEmail(job.data.to);
      return { sent: true };
    }),
  },
});

// from a page action, an API route, anywhere:
await emails.add('send', { to: 'alice@example.com' });
```

### `Mochi.worker()`

```ts
const workerConfig = Mochi.worker<JobData, Result>(processor, options?);
```

`Mochi.worker()` returns an inert config — mount it under the queue name in `Mochi.serve({ workers })`:

```ts
await Mochi.serve({
  workers: {
    emails: Mochi.worker<JobData, Result>(processor, { concurrency: 10 }),
  },
});
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

Options: `concurrency` (jobs processed at once), `dataPath` (see below), and `on` for lifecycle listeners. Subscribe to outcomes via `on`:

```ts
Mochi.worker(processor, {
  concurrency: 10,
  on: {
    completed: (job, result) => log.info(`${job.name} done`),
    failed: (job, error) => log.warn(`${job.name} failed: ${error.message}`),
  },
});
```

Or subscribe globally on the [`mochiEvents` bus](#observability) (filter by `queue` name) — handy when the listener lives far from the worker declaration.

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

### Producer + consumer in one module

The common pattern is a shared module: export the live queue handle (so route code can `.add()` to it) and the worker config (so your entry can mount it).

```ts
// jobs.ts
import { Mochi } from 'mochi-framework';

export const emails = Mochi.queue<{ to: string }>('emails');

export const emailWorker = Mochi.worker<{ to: string }>(async (job) => {
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

```ts
// index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';
import { emailWorker } from './jobs';

await Mochi.serve({
  routes,
  workers: { emails: emailWorker },
});
```

<Callout type="warning">

Every queue you produce to must have a worker mounted under its name. Workers are declared only in `Mochi.serve({ workers })` — there's no dynamic insertion — so a `Mochi.queue()` whose name is missing from the `workers` map is a **fatal startup error** (it would otherwise swallow every job silently). A typo'd queue name fails the same way.

</Callout>

### Persistence

By default the queue is **in-memory** — jobs do not survive a restart. Pass `dataPath` to persist to SQLite:

```ts
const queue = Mochi.queue('emails', { dataPath: '.mochi/queue.sqlite' });
// in Mochi.serve({ workers }):
//   emails: Mochi.worker(processor, { dataPath: '.mochi/queue.sqlite' })
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

// in Mochi.serve({ workers }):
//   'api-calls': Mochi.worker(processor, { bunqueue: { limiter: { max: 100, duration: 1000 } } })

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

A worker is instantiated **once**, by `Mochi.serve({ workers })` — `Mochi.worker()` itself is just inert config, so the dev route hot-reload watcher re-running your modules can't spawn a duplicate consumer.

The trade-off: **changes to a worker's processor or options don't hot-reload** — restart the dev server to apply them. Because the worker module is imported once, you can keep ordinary in-memory state (a results buffer, a counter) in module scope without it being duplicated.

<Callout type="info">

A long-running resource the worker _opens_ (a DB pool, a client connection) is your own singleton — if it must survive a dev module re-run, pin it to `globalThis` the way the framework pins its own internals.

</Callout>

### Shutdown

Queues and workers close gracefully when `Mochi.serve()` receives `SIGTERM`/`SIGINT` — in-flight jobs drain before the process exits. A **worker-only process** (no page/API routes) is just `Mochi.serve({ workers })` with no `routes`:

```ts
// worker.ts — run with `bun worker.ts`
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  workers: {
    emails: Mochi.worker(async (job) => {
      await sendEmail(job.data.to);
    }),
  },
});
```

<Callout type="info">

**Embedded mode only.** Producer and consumer share one process. bunqueue also supports a TCP server mode for distributed workers; Mochi doesn't expose that yet.

</Callout>

### Dependencies

Mochi uses bunqueue as the underlying implementation for queues and workers. To keep the dependency count low, Mochi skips the optional native add-on that bunqueue would otherwise pull in, so it and its platform-specific binaries never land in your install.

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background Jobs", hook: "Offload work to a Mochi.worker() via Mochi.queue() — embedded, no Redis." }]}
/>
