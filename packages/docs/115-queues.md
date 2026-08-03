---
title: 'Queues'
slug: queues
description: 'Run background jobs with Mochi.queue() on a memory, SQLite, or PostgreSQL backend — or any fedify MessageQueue.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Queues

Offload work that shouldn't block a response — sending email, encoding media, calling slow third-party APIs — to a background **queue**. A queue bundles a job channel with the `process` function that consumes it; both run in your process. Messages travel through a pluggable backend — in-memory by default, SQLite or PostgreSQL for persistence — using the [fedify `MessageQueue`](https://fedify.dev/manual/mq) transport model, while retry, backoff, concurrency, and events are handled by Mochi.

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

### Backends

The default backend is `'memory'`: nothing to configure, nothing survives a restart. Choose per queue with the `backend` option, or set a server-wide default with `queueBackend` (a queue's own `backend` overrides it):

```ts
await Mochi.serve({
  // default for every queue in the map
  queueBackend: { sqlite: '.mochi/queue.sqlite' },
  queues: {
    emails: Mochi.queue({ process: sendEmail }),
    // this one overrides the default
    critical: Mochi.queue({ process: charge, backend: { postgres: process.env.DATABASE_URL } }),
  },
});
```

| Backend                   | Persistence | Notes                                                                                               |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `'memory'`                | none        | The default. Jobs are lost on restart — pair with [`recover`](#recovery-on-start).                  |
| `{ sqlite: path }`        | file        | One SQLite file can back many queues (one table each). Single instance only.                        |
| `{ postgres: url }`       | server      | `LISTEN`/`NOTIFY` + polling via [@fedify/postgres](https://www.npmjs.com/package/@fedify/postgres). |
| a `MessageQueue` instance | up to you   | Bring your own fedify driver — Redis, AMQP, or custom. One instance per queue.                      |

Any object implementing fedify's `MessageQueue` interface works as a `backend`, so the whole [fedify driver ecosystem](https://fedify.dev/manual/mq) plugs in:

```ts
import { RedisMessageQueue } from '@fedify/redis';
import Redis from 'ioredis';

Mochi.queue({ process, backend: new RedisMessageQueue(() => new Redis()) });
```

The `fedify` object on the `sqlite` / `postgres` forms is the escape hatch: it is passed verbatim to the driver constructor, so any [`SqliteMessageQueueOptions`](https://www.npmjs.com/package/@fedify/sqlite) / [`PostgresMessageQueueOptions`](https://www.npmjs.com/package/@fedify/postgres) field can be overridden:

```ts
Mochi.queue({
  process,
  backend: { sqlite: '.mochi/queue.sqlite', fedify: { pollInterval: { seconds: 2 }, journalMode: 'WAL' } },
});
```

<Callout type="danger">

**Delivery is at-most-once.** The SQLite and PostgreSQL backends remove a message from the store _before_ the handler runs, so a process crash mid-job loses that job — there is no lock-based reclaim. `recover` is the sanctioned answer: keep the source of truth in your own store and re-enqueue unfinished work at boot. The memory backend loses everything on restart regardless.

</Callout>

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
| `enqueuedAt` | `number` | epoch ms when first enqueued            |

Options: `concurrency` (jobs processed at once), `backend` (see [Backends](#backends)), `backoff` (see [Retries](#retries--backoff)), `defaultJobOptions`, `recover` (a startup callback for re-enqueuing unfinished work — see [Recovery on start](#recovery-on-start)), and `on` for lifecycle listeners:

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

`Mochi.getQueue<JobData>(name)` resolves a mounted queue's handle — call `.add()` on it to add jobs. Pass the payload type explicitly. It throws if the name was never declared in `Mochi.serve({ queues })`, or if reached before `Mochi.serve()` mounted its queues — the message tells you which, so a mistimed call is never reported as a misspelled name.

| Method                   | Returns                                 | Notes                       |
| ------------------------ | --------------------------------------- | --------------------------- |
| `add(name, data, opts?)` | `Promise<MochiJobRef>`                  | enqueue one job             |
| `addBulk(jobs)`          | `Promise<MochiJobRef[]>`                | enqueue many in one call    |
| `depth()`                | `Promise<MochiQueueDepth \| undefined>` | what's waiting in the store |

`MochiJobRef` is `{ id, name }`. Per-job options: `delay` (ms before the job becomes runnable), `attempts`, `orderingKey`.

```ts
const emails = Mochi.getQueue<{ to: string }>('emails');
await emails.add('send', { to: 'bob@example.com' }, { delay: 5000, attempts: 3 });
await emails.addBulk([
  { name: 'send', data: { to: 'a@x.com' } },
  { name: 'send', data: { to: 'b@x.com' }, opts: { delay: 1000 } },
]);
```

`depth()` reports `{ queued, ready?, delayed? }` — messages still waiting in the backend, excluding jobs already handed to `process`. It returns `undefined` when the backend driver doesn't support counting (all three built-ins do).

#### Ordering

Jobs sharing an `orderingKey` are delivered sequentially in enqueue order; jobs without one (or with different keys) can interleave. The guarantee comes from the backend driver and assumes one consumer per key at a time — with `concurrency` above 1 Mochi may still run differently-keyed jobs in parallel, so `concurrency: 1` is the strict spelling:

```ts
await queue.add('create', { noteId: '123' }, { orderingKey: 'note:123' });
await queue.add('delete', { noteId: '123' }, { orderingKey: 'note:123' }); // runs after create
```

### Retries & backoff

A job whose `process` throws is retried until its `attempts` budget (default 1 — no retry) is spent. `backoff` on the queue spaces the retries; `exponential` doubles the base delay each attempt, clamped by `maxDelay`:

```ts
Mochi.queue({
  process: sendEmail,
  defaultJobOptions: { attempts: 3 },
  backoff: { type: 'exponential', delay: 5000, maxDelay: 60_000 },
});
```

Each failure emits [`queue:failed`](#observability) with a `willRetry` flag — `true` while attempts remain, `false` on the terminal failure. Retries are handled by Mochi itself (a re-enqueue with the computed delay), so they behave identically on every backend.

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

### Recovery on start

An in-memory queue loses its jobs on restart, and even a persisted one can't know about work your own database recorded before the job was accepted — or a job lost to a mid-run crash (see the delivery callout above). `recover` runs once at startup — after every queue in `Mochi.serve({ queues })` is mounted — with this queue's handle, so it's the place to add back whatever your store still considers unfinished:

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

A `recover` that never settles is never cut short — abandoning it would drop the jobs it was about to add. Since warmup, `mochi:ready` and `serve()` resolving all wait behind it, Mochi logs a warning naming the queue if one is still running after 30 seconds (tune per queue with the [`queue:recoveryStallWarningMs`](/docs/extensions/) filter).

<Callout type="info">

**Queues mount late.** They are created after the `mochi:init` hook and after the server binds, so `Mochi.getQueue()` throws if you call it from `mochi:init` — the error says as much. Anywhere from the [`mochi:queuesMounted`](/docs/extensions/#mochiqueuesmounted) hook onwards can add jobs: a queue's own `recover` callback, the `mochi:ready` hook, or any request handler.

</Callout>

### Observability

Queues emit [events](/docs/events/) on the `mochiEvents` bus — `queue:added`, `queue:active`, `queue:completed`, `queue:failed` (with `willRetry`), `queue:error` — and the built-in [console logger](/docs/logging/) prints a `QUEUE` line for `added`, `completed`, `failed`, and `error`. Those four print at `warn`, so they're visible under the production default level; demote them with the [`consoleLogger:level` filter](/docs/extensions/) if you don't want them there. The per-attempt `active` line needs `logger: { level: 'debug' }`. Wire your own metrics directly:

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

Queues close gracefully when `Mochi.serve()` receives `SIGTERM`/`SIGINT` — the listen loops stop, in-flight jobs drain, then the backing stores close. Backends Mochi opened itself (memory, sqlite, postgres) are closed for you; a raw `MessageQueue` instance you passed in is yours to close. A **queue-only process** (no page/API routes) is just `Mochi.serve({ queues })` with no `routes`:

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

**One process per queue.** Producers and the consumer share the process — Mochi starts exactly one listen loop per queue, and `recover` runs in every process that boots. The postgres backend's store supports multiple workers, but running several Mochi instances against one queue is not supported yet: recovery would re-enqueue the same work once per instance.

</Callout>

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with queues", hook: "How background job queues work — offload work to a Mochi.queue() with a pluggable backend, no Redis." }]}
/>
