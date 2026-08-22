---
title: 'Scheduled jobs'
slug: scheduled-jobs
ogTitle: 'Scheduled jobs with Mochi.cron()'
description: 'Run recurring work on a cron schedule with Mochi.cron(), backed by Bun.cron().'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Scheduled jobs

<VersionNote since="0.10.0" message="Mochi.cron() and the serve-level cron option ship in the next Mochi release (0.10.0). This page describes the upcoming API." />

Run recurring work — nightly cleanups, hourly syncs, a weekly digest — on a cron schedule inside your server process. `Mochi.cron()` declares a job; `Mochi.serve({ cron })` starts it. Both are backed by [`Bun.cron()`](https://bun.com/docs/runtime/cron).

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

const cleanup = Mochi.cron('cleanup', '0 3 * * *', async () => {
  await purgeExpiredSessions();
});

await Mochi.serve({ cron: [cleanup], routes });
```

The descriptor is inert until `Mochi.serve()` starts it, so declaring one at module scope is free.

### Schedules

Standard 5-field cron syntax — `minute hour day-of-month month day-of-week` — plus the nicknames `@yearly`, `@monthly`, `@weekly`, `@daily`, `@hourly`. Month and weekday accept names (`MON-FRI`, `JAN`).

```ts
Mochi.cron('every-15-min', '*/15 * * * *', run);
Mochi.cron('weekdays-at-9', '0 9 * * MON-FRI', run);
Mochi.cron('nightly', '@daily', run);
```

An invalid expression throws **at declaration**, not at boot, so a typo fails when the module is imported rather than after a deploy.

### Options

Pass `{ run, … }` instead of a bare handler:

- `tz` — IANA time-zone name the schedule is read in. Defaults to the system zone, matching `crontab` and `launchd`.
- `dev` — set `false` to skip the job when `development: true`. Default `true`.
- `on` — `{ active, completed, failed }` listeners.

```ts
Mochi.cron('digest', '0 9 * * MON', {
  tz: 'Europe/Stockholm',
  dev: false,
  run: async () => sendWeeklyDigest(),
  on: { failed: (run, error) => reportToSentry(error) },
});
```

### Invocations never overlap

The next fire is computed only once your handler settles. A handler that takes 90 seconds on a `* * * * *` schedule next runs at the first minute boundary _after_ it finishes — invocations never stack.

### A failing job does not stop the schedule

A handler that throws is reported through the `cron:failed` event and a `consoleLogger()` warning, then the job stays scheduled and runs again at its next occurrence.

<Callout type="info">

This is the main reason to declare jobs through Mochi rather than calling `Bun.cron()` directly: a bare handler that throws reaches `uncaughtException`/`unhandledRejection` and exits the process with code 1.

</Callout>

### Events

| Event            | Payload                              | When                                    |
| ---------------- | ------------------------------------ | --------------------------------------- |
| `cron:scheduled` | `{ job, schedule, tz?, nextRun? }`   | The job was registered at startup.      |
| `cron:active`    | `{ job, schedule, scheduledTime }`   | An invocation started.                  |
| `cron:completed` | `{ job, schedule, duration }`        | The handler resolved.                   |
| `cron:failed`    | `{ job, schedule, duration, error }` | The handler threw; the schedule stands. |

### Every instance runs every job

Jobs are in-process, so an app scaled to N replicas fires each job N times. For work that must happen once per schedule, have the handler enqueue onto a [queue](/docs/queues/) backed by shared storage and let one worker win.

```ts
Mochi.cron('nightly-report', '@daily', async () => {
  // `id` makes the add idempotent, so N replicas enqueue one job.
  await reports.add({ day: new Date().toISOString().slice(0, 10) }, { id: `report-${new Date().toISOString().slice(0, 10)}` });
});
```

<Callout type="warning">

Editing the `cron` array in development needs a dev-server restart — the watcher only diffs `routes`. Same limitation as `queues`.

</Callout>

### Shutdown

Jobs stop on `SIGTERM`/`SIGINT`, on `server.stop()`, and on [`Mochi.stop()`](/docs/queues/#mochistop) — before the queues drain, so a job firing mid-shutdown cannot enqueue into a closing queue runtime.
