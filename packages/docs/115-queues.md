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

Offload work that shouldn't block a response — sending email, encoding media, calling slow third-party APIs — to a background **queue**. A queue bundles a job channel with the `process` function that consumes it; both run in your process, backed by [bunqueue](https://bunqueue.dev/)'s embedded mode.

`Mochi.queue()` — like `Mochi.page` / `api` / `ws` / `sse` — returns an **inert config** that you mount in `Mochi.serve({ queues })`, keyed by name, so every background queue the server runs is declared in one place. Add jobs from anywhere with `Mochi.getQueue(name).add(...)`.

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

`Mochi.queue()` returns an inert config — mount it under the queue name in `Mochi.serve({ queues })`. The required `process` function receives a read-only `MochiJob<T>` and returns the job result:

| Field        | Type     | Notes                                   |
| ------------ | -------- | --------------------------------------- |
| `id`         | `string` | job id                                  |
| `name`       | `string` | job name passed to `add()`              |
| `data`       | `T`      | the enqueued payload                    |
| `queue`      | `string` | queue name                              |
| `attempt`    | `number` | 1-based attempt number (1 on first run) |
| `enqueuedAt` | `number` | epoch ms when enqueued                  |

Options: `concurrency` (jobs processed at once), `dataPath` (see below), `recover` (a startup callback for re-enqueuing unfinished work — see [Recovery on start](#recovery-on-start)), and `on` for lifecycle listeners:

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

Or subscribe globally on the [`mochiEvents` bus](#observability) (filter by `queue` name) — handy when the listener lives far from the queue declaration.

### `Mochi.getQueue()`

`Mochi.getQueue<JobData>(name)` resolves a mounted queue's handle — call `.add()` on it to add jobs. Pass the payload type explicitly. It throws if the name was never declared in `Mochi.serve({ queues })`, or if reached before `Mochi.serve()` mounted its queues.

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

The common pattern is a shared module that exports the queue config (so your entry can mount it) while route code adds jobs by name.

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
        await Mochi.getQueue<{ to: string }>('emails').add('send', { to: String(data.get('email')) });
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

### Persistence

By default the queue is **in-memory** — jobs do not survive a restart. Pass `dataPath` to persist to SQLite:

```ts
Mochi.queue({ process, dataPath: '.mochi/queue.sqlite' });
```

<Callout type="warning">

bunqueue locks the embedded store to the **first** `dataPath` used in the process. Use one `dataPath` across all your queues; conflicting paths are ignored (Mochi logs a warning).

</Callout>

### Recovery on start

An in-memory queue loses its jobs on restart, and even a persisted one can't know about work your own database recorded before the job was accepted. `recover` runs once at startup — after every queue in `Mochi.serve({ queues })` is mounted — with this queue's handle, so it's the place to add back whatever your store still considers unfinished:

```ts
Mochi.queue<{ id: number }>({
  process: sendEmail,
  recover: async (queue) => {
    // Rows your app marked unsent are the source of truth, not the queue.
    await queue.addBulk(pendingEmailIds().map((id) => ({ name: 'send', data: { id } })));
  },
});
```

Recovery is awaited before `Mochi.serve()` resolves, so recovered jobs are enqueued before the `mochi:ready` hook fires. Because the server is already bound and serving by then, a throw is contained: Mochi logs it and emits `queue:error`, and the server keeps running.

<Callout type="info">

**Queues mount late.** They are created after the `mochi:init` hook and after the server binds, so `Mochi.getQueue()` throws if you call it from `mochi:init` — the error says as much. Anywhere that runs later can add jobs: a queue's own `recover` callback, the `mochi:ready` hook, or any request handler.

</Callout>

### Advanced options

Mochi wraps a small, stable core. For bunqueue features Mochi doesn't surface first-class — retry backoff, rate limiting, cron/repeat, dead-letter queue, deduplication — pass a `bunqueue` object that is forwarded verbatim to the underlying queue and worker:

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

### Observability

Queues emit [events](/docs/events/) on the `mochiEvents` bus — `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error` — and the built-in [console logger](/docs/logging/) prints a `QUEUE` line per job. Wire your own metrics directly:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('queue:completed', ({ queue, jobName, duration }) => {
  metrics.timing('queue.job', duration, { queue, job: jobName });
});
```

### Dev mode & hot reload

A queue is instantiated **once**, by `Mochi.serve({ queues })` — `Mochi.queue()` itself is just inert config, so the dev route hot-reload watcher re-running your modules can't spawn a duplicate consumer.

The trade-off: **changes to a queue's `process` function or options don't hot-reload** — restart the dev server to apply them. Because the queue module is imported once, you can keep ordinary in-memory state (a results buffer, a counter) in module scope without it being duplicated.

<Callout type="info">

A long-running resource the `process` function _opens_ (a DB pool, a client connection) is your own singleton — if it must survive a dev module re-run, pin it to `globalThis` the way the framework pins its own internals.

</Callout>

### Shutdown

Queues close gracefully when `Mochi.serve()` receives `SIGTERM`/`SIGINT` — in-flight jobs drain before the process exits. A **queue-only process** (no page/API routes) is just `Mochi.serve({ queues })` with no `routes`:

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

**Embedded mode only.** The code that adds jobs and the worker that runs them share one process. bunqueue also supports a TCP server mode for distributed workers; Mochi doesn't expose that yet.

</Callout>

### Dependencies

Mochi uses bunqueue as the underlying implementation for queues. bunqueue pulls in `msgpackr`, whose optional native accelerator (`msgpackr-extract`) would otherwise drag platform-specific prebuilt binaries into your install — so Mochi swaps it out via a `package.json` `overrides` entry pointing at [`@mochi-framework/msgpackr-extract-stub`](https://www.npmjs.com/package/@mochi-framework/msgpackr-extract-stub), an empty stub that keeps `msgpackr` on its pure-JS codec so no native binaries are installed. New projects scaffolded with `create-mochi` ship this override by default — to opt out and use the native bindings, just delete the `overrides` entry from your `package.json`.

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with queues", hook: "Offload work to a Mochi.queue() with an embedded worker — no Redis." }]}
/>
