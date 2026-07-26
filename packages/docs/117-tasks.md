---
title: 'Scheduled Tasks'
slug: tasks
description: 'Run work on a cron schedule with Mochi.task(), including single-runner coordination across multiple processes.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Scheduled Tasks

`Mochi.task()` runs work on a schedule — recurring with `cron`, or once with `at`. Declare tasks in `Mochi.serve({ tasks })`; they start with the server and stop cleanly on shutdown.

```ts
// src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes,
  tasks: {
    'prune-sessions': Mochi.task({
      cron: '0 3 * * *', // 03:00 every day
      run: async () => {
        await db`DELETE FROM sessions WHERE expires_at < NOW()`;
      },
    }),
  },
});
```

Scale that app to three replicas and `prune-sessions` still runs once per night, not three times — one node wins a lease and runs the schedule. See [Multiple processes](#multiple-processes).

### Patterns

The pattern takes 5 fields, or 6 when you lead with seconds. `at` takes a `Date` or ISO 8601 string and fires once.

| Pattern                      | Fires                  |
| ---------------------------- | ---------------------- |
| `'*/5 * * * *'`              | Every 5 minutes        |
| `'0 3 * * *'`                | 03:00 daily            |
| `'0 0 * * MON'`              | Midnight on Mondays    |
| `'*/30 * * * * *'`           | Every 30 seconds       |
| `'@hourly'`                  | Top of every hour      |
| `at: '2027-01-01T00:00:00Z'` | Once, then never again |

### Options

| Option     | Default      |                                                                     |
| ---------- | ------------ | ------------------------------------------------------------------- |
| `cron`     | —            | Cron pattern. Exactly one of `cron` or `at` is required.            |
| `at`       | —            | `Date` or ISO string for a one-off run.                             |
| `run`      | _(required)_ | `(ctx) => void \| Promise<void>`. `ctx` is `{ name, scheduledAt }`. |
| `timezone` | host zone    | IANA zone the pattern is read in, e.g. `'Europe/Stockholm'`.        |
| `overlap`  | `false`      | Allow a tick to start while the previous run is still going.        |
| `scope`    | `'cluster'`  | `'cluster'` runs on one node; `'node'` runs on every node.          |
| `paused`   | `false`      | Register without scheduling. Start it with the handle's `resume()`. |
| `on.error` | —            | `(error, ctx) => void`, called after the failure is logged.         |

A task that throws is logged and reported as `task:error`; it never takes the server down. With `overlap` off (the default) a tick that arrives while the previous run is still going is dropped and reported as `task:skipped` — a job that slows down won't pile up copies of itself.

### Handles

`Mochi.task(name, config)` registers immediately and returns a handle, as an alternative to the `tasks` map. Put it in a module that is imported before `Mochi.serve()` runs — a route file, typically.

```ts
const report = Mochi.task('nightly-report', { cron: '0 2 * * *', run: sendReport });

report.nextRun(); // Date | null
report.trigger(); // run now, regardless of schedule or leadership
report.pause();
```

`Mochi.getTask(name)` resolves the same handle anywhere after startup. Both expose `nextRun()`, `previousRun()`, `isScheduled()`, `isBusy()`, `trigger()`, `pause()` and `resume()`.

### Multiple processes

A `'cluster'` task must run on exactly one node. Every node contends for a lease in shared storage; the winner runs the schedule and the rest stay idle. Leadership is decided by a single atomic statement, so there is no window in which two nodes both believe they won.

```ts
await Mochi.serve({
  routes,
  tasks: { 'prune-sessions': prune },
  scheduler: {
    lease: { url: process.env.MOCHI_SCHEDULER_URL },
  },
});
```

<Callout type="warning">

**Every node must reach the same storage.** The default is a SQLite file under `outDir`, which is per-container on a typical deployment — so each container elects itself and the task runs everywhere. Point `lease.url` (or `MOCHI_SCHEDULER_URL`) at a volume every replica mounts, or at Postgres. SQLite is fine for replicas sharing one host's volume; across hosts, use Postgres.

</Callout>

| Scheduler option    | Default               |                                                                      |
| ------------------- | --------------------- | -------------------------------------------------------------------- |
| `leader`            | `!development`        | Elect a single runner. `false` runs every task on every node.        |
| `lease.url`         | `outDir/tasks.sqlite` | `sqlite://…` or `postgres://…`. Falls back to `MOCHI_SCHEDULER_URL`. |
| `lease.name`        | `mochi:tasks:leader`  | Lease key, so several apps can share one database.                   |
| `lease.table`       | `mochi_lease`         | Table name; created on first use.                                    |
| `leaseTtl`          | `60_000`              | How long a lease survives without a heartbeat.                       |
| `heartbeatInterval` | `leaseTtl / 3`        | How often the leader refreshes it.                                   |
| `startupJitter`     | `30_000`              | Random delay before the first election, to spread a fleet boot.      |
| `drainTimeout`      | `5_000`               | How long shutdown waits for in-flight runs.                          |

The leader refreshes its lease every `heartbeatInterval`. If a refresh comes back rejected — a newer deploy took over, or this node was frozen long enough to expire — it stops its tasks immediately, so a split brain always collapses within one heartbeat. On graceful shutdown the lease is released outright and a peer takes over at once instead of waiting out the TTL.

Set `scope: 'node'` for work that genuinely belongs on every process, like trimming a local cache. Node-scoped tasks never touch the lease.

`leader` is the app's single cluster-coordination switch: it also makes [queue recovery](/docs/queues/#recovery-on-start) single-flight, so a rolling deploy doesn't re-enqueue the same stranded jobs once per replica. Leaving the lease location unset while `leader` is on logs a warning at boot, because that default is a container-local file — the one misconfiguration that otherwise fails silently.

### Deploys

Build metadata lets a rolling deploy hand the schedule over immediately rather than idling for a full TTL: a node from a strictly newer build preempts an older one on sight, and an older build can never preempt a newer one. `mochi-framework build` stamps this automatically; set `MOCHI_BUILD_ID` in CI to record something meaningful, like a git sha.

<Callout type="info">

Running in dev mode with no prebuilt manifest, there is no build stamp, so takeover falls back to TTL expiry — correct, just slower. Set `MOCHI_BUILD_TIME` (epoch ms) to restore instant handover.

</Callout>

Missed ticks are not replayed. During a failover gap, or the startup jitter window, whatever was scheduled is skipped rather than run late in a burst. A one-off `at` task fires at most once per scheduled time on whichever node holds the lease at that moment.

### Events

| Event          | Payload                       | When                                   |
| -------------- | ----------------------------- | -------------------------------------- |
| `task:run`     | `{ task, scope, duration }`   | A run finished successfully.           |
| `task:error`   | `{ task, error, duration }`   | A run threw. The server keeps serving. |
| `task:skipped` | `{ task, reason }`            | Dropped: `overlap` or `lease-expired`. |
| `task:leader`  | `{ acquired, owner, holder }` | This node gained or lost the lease.    |

`consoleLogger()` prints all four, so which node owns the schedule is visible in the logs.

### Server-only

Tasks run on the server. Declare them in `.ts` modules, never inside a `mochi:hydrate` component.

<SeeItInAction
demos={[
{ href: "/demos/tasks/", title: "Scheduled tasks", hook: "A live cron ticking, with its next run and recent history." },
{ href: "/demos/queue/", title: "Background jobs with queues", hook: "For work triggered by a request rather than a clock." },
]}
/>
