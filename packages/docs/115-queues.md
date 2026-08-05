---
title: 'Queues'
slug: queues
description: 'Run background jobs with Mochi.queue() — in-memory, SQLite, or Postgres via @mochi-framework/queue.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Queues

Offload work that shouldn't block a response — sending email, encoding media, calling slow third-party APIs — to a background **queue**. A queue bundles a job channel with the `process` function that consumes it, backed by [`@mochi-framework/queue`](https://www.npmjs.com/package/@mochi-framework/queue): a minimal SQL-backed engine that stores jobs in-memory, in a SQLite file, or in Postgres through `Bun.SQL`.

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

Options: `concurrency` (jobs processed at once), `database` (see [Choosing a database](#choosing-a-database)), `lockDuration` (see [Long-running jobs](#long-running-jobs)), `defaultJobOptions` (per-job options applied to every `add`), `recover` (a startup callback for re-enqueuing unfinished work — see [Recovery on start](#recovery-on-start)), and `on` for lifecycle listeners:

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

| Method                   | Returns                  | Notes                    |
| ------------------------ | ------------------------ | ------------------------ |
| `add(name, data, opts?)` | `Promise<MochiJobRef>`   | enqueue one job          |
| `addBulk(jobs)`          | `Promise<MochiJobRef[]>` | enqueue many in one call |

`MochiJobRef` is `{ id, name, deduplicated }`. Per-job options: `priority` (lower runs first), `delay` (ms), `attempts`, `backoff`, `jobId`.

```ts
const emails = Mochi.getQueue<{ to: string }>('emails');
await emails.add('send', { to: 'bob@example.com' }, { priority: 10, delay: 5000 });
await emails.addBulk([
  { name: 'send', data: { to: 'a@x.com' } },
  { name: 'send', data: { to: 'b@x.com' }, opts: { priority: 10 } },
]);
```

<Callout type="info">

Job payloads are stored as JSON — `data` must be JSON-serializable. Adding a `jobId` that is still **outstanding** in the queue is a no-op: nothing is enqueued, no `queue:added` fires, and the returned ref carries the stored job's `name` with `deduplicated: true`. Once the job completes or fails terminally its row is deleted, and the id is reusable.

</Callout>

### Retries

`attempts` sets how many times a job may run; `backoff` spaces the retries out:

```ts
Mochi.queue({
  process: sendEmail,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
});
```

`backoff.type` is `'fixed'` (every retry waits `delay` ms) or `'exponential'` (`delay`, `2×delay`, `4×delay`, …). Without `backoff`, retries run immediately. The `failed` listener fires on every failed attempt with the error; a job that exhausts its attempts is dropped from the store — your own database is the durable record of what still needs doing (see [Recovery on start](#recovery-on-start)).

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

### Choosing a database

By default the queue is **in-memory** (a private SQLite store) — jobs do not survive a restart. Pass `database` to persist, or to share the queue between processes:

```ts
Mochi.queue({ process, database: 'sqlite://.mochi/queue.sqlite' });
Mochi.queue({ process, database: 'postgres://user:pw@host:5432/app' });
Mochi.queue({ process, database: myBunSqlInstance }); // share your app's Bun.SQL handle
```

Queues on the same `database` share one `mochi_jobs` table (a `queue` column keeps them apart), and all default in-memory queues share one store per process. A `SQL` instance you pass in is yours — the framework never closes it; string databases are opened and closed by the framework.

### Multiple instances

Any number of processes can work the same queue against a shared `database` (a SQLite file on one machine, Postgres across machines). Claims are atomic — `FOR UPDATE SKIP LOCKED` on Postgres, a single atomic `UPDATE` on SQLite — so **every job runs exactly once**, whichever instance gets it.

A claimed job holds a **lease** that the owning instance renews on a heartbeat while the job runs. If the instance crashes, the lease expires and a surviving instance reclaims the job; the crashed claim counts as a spent attempt, so `job.attempt` tells the retry it isn't the first try.

### Long-running jobs

`lockDuration` (default **60 s**) is the lease TTL, not a runtime limit: the heartbeat keeps renewing it, so a two-hour job stays owned as long as its process is alive. It only expires — handing the job to another instance — when the instance dies or its event loop is blocked solid past the TTL.

```ts
Mochi.queue({ process: resizeImage, lockDuration: 10_000 }); // reclaim crashed instances' jobs faster
```

<Callout type="warning">

A fully **blocked event loop** starves the heartbeat like any visibility-timeout system: if `process` spends longer than `lockDuration` in synchronous work, the lease lapses and the job can be reclaimed while still running. The late result is then discarded (the settle is fenced by a per-claim token — no double completion), but the other instance will have run the job again. Keep `lockDuration` above your worst synchronous stretch; ordinary `await`-ing work of any length is fine.

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

**Single-flight across instances.** With a shared `database`, a recovery lease in the store lets exactly one booting instance run `recover` per TTL window (default 60 s, tune with `recoveryLeaseMs`) — a rolling restart's second instance skips the recovery the first just ran instead of re-enqueueing every stranded job again. A `recover` that **throws** releases the lease so the next boot retries immediately. With the in-memory default each process has a private store, so each runs its own recovery — same as before.

A `recover` that never settles is never cut short — abandoning it would drop the jobs it was about to add. Since warmup, `mochi:ready` and `serve()` resolving all wait behind it, Mochi logs a warning naming the queue if one is still running after 30 seconds.

<Callout type="info">

**Queues mount late.** They are created after the `mochi:init` hook and after the server binds, so `Mochi.getQueue()` throws if you call it from `mochi:init` — the error says as much. Anywhere from the [`mochi:queuesMounted`](/docs/extensions/#mochiqueuesmounted) hook onwards can add jobs: a queue's own `recover` callback, the `mochi:ready` hook, or any request handler.

</Callout>

### Observability

Queues emit [events](/docs/events/) on the `mochiEvents` bus — `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error` — and the built-in [console logger](/docs/logging/) prints a `QUEUE` line for `added`, `completed`, `failed`, and `error`. Those four print at `warn`, so they're visible under the production default level; demote them with the [`consoleLogger:level` filter](/docs/extensions/) if you don't want them there. The per-attempt `active` line needs `logger: { level: 'debug' }`. Wire your own metrics directly:

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

Queues close gracefully when `Mochi.serve()` receives `SIGTERM`/`SIGINT` — in-flight jobs drain before the process exits, and anything still pending stays in the store for the next boot (or a sibling instance) to pick up. A **queue-only process** (no page/API routes) is just `Mochi.serve({ queues })` with no `routes`:

```ts
// worker.ts — run with `bun worker.ts`
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  queues: {
    emails: Mochi.queue({
      database: 'postgres://user:pw@host:5432/app',
      process: async (job) => {
        await sendEmail(job.data.to);
      },
    }),
  },
});
```

Point it at the same `database` as your web process and it becomes a dedicated worker — the web process adds jobs, the worker runs them.

### Standalone use

The engine has no dependency on the framework — `@mochi-framework/queue` exports `createQueue()` directly for scripts and non-Mochi apps. What `Mochi.serve({ queues })` adds on top is the declaration map, `Mochi.getQueue`, lifecycle events on the bus, recovery orchestration, and shutdown draining.

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with queues", hook: "How background job queues work — offload work to a Mochi.queue() backed by SQLite or Postgres, no Redis." }]}
/>
