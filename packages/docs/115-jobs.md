---
title: 'Background Jobs'
slug: jobs
description: 'Durable, typed job chains with Mochi.jobs(), backed by queuert — memory, SQLite, or Postgres.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Background Jobs

Offload work that shouldn't block a response — sending email, encoding media, calling slow third-party APIs — to a background **job chain**. Jobs are typed with `defineJobTypes`, processed in your own process by [queuert](https://kvet.github.io/queuert/), and stored in one of three backends: in-memory, SQLite (`bun:sqlite`), or Postgres (`Bun.SQL`).

`Mochi.jobs()` — like `Mochi.page` / `api` / `ws` / `sse` — returns an **inert descriptor** that you mount via `Mochi.serve({ jobs })`. The descriptor doubles as the typed handle: export it, and call `startChain` on it from anywhere server-side.

```ts
import { Mochi, defineJobTypes } from 'mochi-framework';

const jobs = Mochi.jobs({
  backend: { kind: 'sqlite', path: '.db/jobs.sqlite' }, // default: { kind: 'memory' }
  concurrency: 10,
  types: defineJobTypes<{
    'send-email': { entry: true; input: { to: string }; output: { sent: boolean } };
  }>(),
  processors: {
    'send-email': {
      attemptHandler: async ({ job, complete }) => {
        await sendEmail(job.input.to);
        return complete(async () => ({ sent: true }));
      },
    },
  },
});

await Mochi.serve({ routes, jobs });

// from a page action, an API route, anywhere:
const chain = await jobs.startChain({ typeName: 'send-email', input: { to: 'alice@example.com' } });
await jobs.awaitChain({ id: chain.id }, { timeoutMs: 10_000 }); // optional — only if you need the result
```

A wrong-shape `input` is a compile error, and `job.input` inside each handler is fully typed.

### Chains

A chain is one or more jobs run in sequence. Declare the next step with `continueWith` in the type, then call it from the handler's `complete` callback — a continuation whose `input` doesn't match the next type's declaration is a compile error:

```ts
types: defineJobTypes<{
  'provision-account': { entry: true; input: { userId: number }; continueWith: { typeName: 'send-welcome-email' } };
  'send-welcome-email': { input: { userId: number; accountId: string }; output: { sent: boolean } };
}>(),
processors: {
  'provision-account': {
    attemptHandler: async ({ job, complete }) => {
      const accountId = await provisionAccount(job.input.userId);
      return complete(async ({ continueWith }) =>
        continueWith({ typeName: 'send-welcome-email', input: { userId: job.input.userId, accountId } }));
    },
  },
  // …
}
```

Only types marked `entry: true` can start a chain. `jobs.client()` exposes the full queuert client — `getChain`, `listChains`, `completeChain`, `rescheduleJob`, blockers — with the same type inference.

### Backends

| Backend    | Config                                                       | Notes                                                                                                   |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `memory`   | `{ kind: 'memory' }` (default)                               | Jobs vanish on restart; ideal for dev and tests                                                         |
| `sqlite`   | `{ kind: 'sqlite', path }` or `{ kind: 'sqlite', database }` | Durable, zero infra; `database` shares an existing `bun:sqlite` handle                                  |
| `postgres` | `{ kind: 'postgres', url }` or `{ kind: 'postgres', sql }`   | Durable, multi-instance; `sql` shares an existing `Bun.SQL` instance — omit `url` to use `DATABASE_URL` |

Durable backends run queuert's schema migrations at mount, in dedicated `queuert_*` tables. Pending chains survive a restart and are picked up by the next boot — no re-enqueue pass needed.

<Callout type="warning">

Same-process enqueues wake the worker instantly, but Bun's `SQL` client has no LISTEN/NOTIFY yet, so on Postgres **other** instances pick new jobs up on the poll (`pollIntervalMs`, default `2000`). Pass a real LISTEN/NOTIFY adapter via `queuert.notifyAdapter` if sub-second cross-instance wakeup matters.

</Callout>

### Transactional enqueue

Share the backend handle with your app and a domain write plus its job commit in **one** transaction — no outbox, no crash window between "row stored" and "job accepted":

```ts
import { db } from './db.server'; // your bun:sqlite Database

const jobs = Mochi.jobs({ backend: { kind: 'sqlite', database: db }, types, processors });

// in an action:
await jobs.withTransaction(async ({ tx, transactionHooks }) => {
  const id = insertTicket(db, fields); // same connection → joins the transaction
  await jobs.startChain({ typeName: 'send-email', input: { id }, tx, transactionHooks });
});
```

If the callback throws, the row and the chain roll back together. Without `tx`, `startChain` runs in its own transaction.

<Callout type="warning">

On a shared `bun:sqlite` handle, run your **writes** through `jobs.withTransaction()` (or inside a handler's `complete` callback, which joins the job's own transaction). A bare write can interleave into an open job transaction on the same connection and roll back with it.

</Callout>

### Retries & scheduling

A handler that throws is retried with exponential backoff — forever, by design: durable work should not be dropped by a counter. A job that should give up completes with a failure-shaped output once `job.attempt` crosses its own threshold:

```ts
Mochi.jobs({
  retry: { initialDelayMs: 5_000, maxDelayMs: 300_000, multiplier: 2 }, // default: 10s → 300s, ×2
  processors: {
    'send-email': {
      attemptHandler: async ({ job, complete }) => {
        try {
          await sendEmail(job.input.to);
        } catch (err) {
          if (job.attempt >= 3) return complete(async () => ({ sent: false })); // terminal
          throw err; // retry with backoff
        }
        return complete(async () => ({ sent: true }));
      },
    },
  },
});
```

Per-chain options on `startChain`: `schedule: { at }` / `{ afterMs }` to run later, `deduplication: { key }` to collapse identical chains into one (at-most-once by construction), `id` to pick the chain id, `blockers` to wait on other chains. `rescheduleJob` (exported from `mochi-framework`) can be thrown from a handler for explicit rate-limit-style rescheduling.

While an attempt runs, its lease auto-renews — a long job never needs a longer lease. `leaseMs` (default `60_000`) only controls how fast a **crashed** worker's job is reclaimed; the [`jobs:leaseMs`](extensions) filter gets the final say.

### Observability

Jobs emit [events](events) on the `mochiEvents` bus — `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error` — where `queue` is the chain's entry type name and `jobName` the job type. The built-in [console logger](logging) prints a `QUEUE` line for `added`, `completed`, `failed`, and `error`. Wire your own metrics directly:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('queue:completed', ({ queue, jobName, duration }) => {
  metrics.timing('jobs.attempt', duration, { chain: queue, job: jobName });
});
```

Events fire post-commit — a rolled-back `startChain` emits nothing.

### Advanced options

Mochi surfaces a small, stable core. Everything else reaches the underlying library through the `queuert` escape hatch, forwarded verbatim (and spread last, so it overrides the derived option next to it):

```ts
Mochi.jobs({
  types,
  processors,
  queuert: {
    client: { log: (entry) => pino.info(entry) }, // composes with Mochi's own event log
    worker: { recoveryBackoffConfig: { initialDelayMs: 1_000, maxDelayMs: 30_000 } },
    stateAdapter: { tablePrefix: 'jobs_' },
    notifyAdapter: myPgNotifyAdapter, // full adapter replacement
    observabilityAdapter: otelAdapter, // e.g. @queuert/otel
  },
});
```

See the [queuert reference](https://kvet.github.io/queuert/reference/queuert/client/) for the full option set. The provider factories `createBunSqliteStateProvider` / `createBunSqlStateProvider` are exported for wiring custom adapters.

### Mount timing & shutdown

The runtime mounts after the server binds — the descriptor's methods reject before that, and the error says so. Anywhere from the [`mochi:jobsMounted`](extensions) hook onwards can start chains: the `mochi:ready` hook, or any request handler. On `SIGTERM`/`SIGINT` (and `server.stop()`), the worker finishes in-flight attempts, stops pulling, and the backend closes — a durable backend keeps the rest for the next boot.

A **worker-only process** is `Mochi.serve({ jobs })` with no `routes`, pointed at the same database as the web instances.

<SeeItInAction
demos={[{ href: "/demos/queue/", title: "Background jobs with chains", hook: "Durable, typed job chains — offload work to Mochi.jobs() with memory, SQLite, or Postgres state, no Redis." }]}
/>
