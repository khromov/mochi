---
title: 'Scheduled jobs'
slug: scheduled-jobs
ogTitle: 'Durable scheduled jobs with Mochi.cron()'
description: 'Run recurring work on a cron schedule with Mochi.cron(), backed by a durable, multi-node scheduler.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Scheduled jobs

<VersionNote since="0.10.0" message="Mochi.cron() and the serve-level cron option ship in the next Mochi release (0.10.0). This page describes the upcoming API." />

Run recurring work — nightly cleanups, hourly syncs, a weekly digest — on a cron schedule. `Mochi.cron()` declares a job; `Mochi.serve({ cron })` starts it. Jobs are **durable** and **run once across a multi-node setup**: the schedule is persisted and a single node is elected per firing, so scaling to N nodes does not fire a job N times.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

const cleanup = Mochi.cron('cleanup', '0 3 * * *', async () => {
  await purgeExpiredSessions();
});

await Mochi.serve({ cron: [cleanup], routes });
```

The third argument is the handler — a bare function as above, or `{ run, … }` when you need [options](#options). The descriptor is inert until `Mochi.serve()` starts it, so declaring one at module scope is free.

### Storage

`cronStorage` sets where schedules and their jobs live:

```ts
await Mochi.serve({
  queueStorage: { postgres: process.env.DATABASE_URL },
  cronStorage: { sqlite: '.db/cron.sqlite' }, // cron on its own store
  cron: [cleanup],
});
```

- Accepts `memory`, `{ sqlite }`, `{ postgres }`, or `{ pglite }`.
- **Defaults to `memory`**, independent of `queueStorage`. Cron always runs on its own instance, so queues and cron never share tables even when pointed at the same store.

<Callout type="warning">

`memory` (and any per-node store) coordinates the run-once guarantee only **within one process**. For a multi-node deployment, point `cronStorage` at shared storage — Postgres, or a SQLite file on a shared volume.

</Callout>

### Schedules

Standard 5-field cron syntax — `minute hour day-of-month month day-of-week` — plus the nicknames `@yearly`, `@monthly`, `@weekly`, `@daily`, `@hourly`. Month and weekday accept names (`MON-FRI`, `JAN`). Resolution is **one minute** — the smallest interval is `* * * * *`.

```ts
Mochi.cron('every-15-min', '*/15 * * * *', run);
Mochi.cron('weekdays-at-9', '0 9 * * MON-FRI', run);
Mochi.cron('nightly', '@daily', run);
```

An invalid expression throws **at declaration**, not at boot, so a typo fails when the module is imported rather than after a deploy.

### Options

Instead of a bare handler, pass `{ run, … }`:

- `tz` — IANA time-zone name the schedule is read in. Defaults to **UTC** — durable cron reads one zone across every node.
- `dev` — set `false` to skip the job when `development: true`. Default `true`.

```ts
Mochi.cron('digest', '0 9 * * MON', {
  tz: 'Europe/Stockholm',
  dev: false,
  run: async () => sendWeeklyDigest(),
});
```

### Runs once, transactionally, across a multi-node setup

Each firing is claimed by exactly one node through an atomic database update, and the enqueue is deduplicated by a per-minute key. You do **not** need to hand-roll an idempotency key — the scheduler handles the race, and it corrects for clock skew against database time. This is the reason cron is durable rather than a per-node timer.

### A run is a queue job

A scheduled run executes internally as a [queue](/docs/queues/) job named `cron-<name>`, so its lifecycle surfaces through the queue events — `queue:active`, `queue:completed`, `queue:failed` with `queue: "cron-<name>"`. Registration emits one `cron:scheduled` event.

A handler that throws is reported through `queue:failed` and logged; the schedule stays registered and runs again at its next occurrence.

<Callout type="info">

The `cron-` prefix is reserved: a `Mochi.queue()` name may not start with it, so cron jobs and queues never collide.

</Callout>

### Editing and removing jobs

Schedules persist in the database. On each boot Mochi reconciles: it registers the declared jobs and **removes any schedule it manages that is no longer declared**, so deleting a `Mochi.cron()` line cleans up its schedule instead of leaving an orphan that keeps enqueuing jobs no worker consumes. In development, editing the `cron` array re-registers on save — no dev-server restart needed.

### Shutdown

The scheduler stops on `SIGTERM`/`SIGINT`, on `server.stop()`, and on [`Mochi.stop()`](/docs/queues/#mochistop). Schedules are **not** removed on shutdown — they are durable and resume on the next boot.
