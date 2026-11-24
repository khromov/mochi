# [HIGH_BUG] Cron reconcile deletes every undeclared schedule in shared cron storage, so a dev boot silently unschedules production `dev: false` jobs

**File:** [`packages/mochi/src/queue.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/queue.ts#L938-L969) (lines 938, 966, 967, 969)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`startCronRuntime` filters out dev-skipped jobs — `const active = jobs.filter((job) => !(opts.development && job.options?.dev === false))` (L938) — and then reconciles against storage using only that filtered set:

    const declaredQueues = new Set(active.map((job) => cronQueueName(job.name)));
    for (const schedule of await boss.getSchedules()) {
      if (!declaredQueues.has(schedule.name)) { await boss.unschedule(schedule.name); }
    }

`boss.getSchedules()` returns **every** schedule in the `mochi_cron` schema (L871), not just the ones this process owns, so "no longer declared" is evaluated against one process's view of a store that is explicitly meant to be shared: `docs/118-scheduled-jobs.md:57` instructs multi-node deployments to "point `cronStorage` at shared storage — Postgres, or a SQLite file on a shared volume", and :114 describes the reconcile as removing "any schedule **it manages**" — implying an ownership scope the implementation does not have.

Two concrete failure modes:
1. A developer runs `bun run dev` with `cronStorage` resolved from a shared `DATABASE_URL`/`.env` (or any node boots with `development: true`). Every job marked `dev: false` — precisely the jobs that only ever run in production — is absent from `active`, so the dev boot **unschedules them from the shared store**. They stop firing fleet-wide and, because schedules are durable and only re-registered by a declaring boot, stay stopped until a production node restarts. Scheduled billing/cleanup/email work silently stops with no error, only an `unschedule` call.
2. Two different Mochi apps pointed at one Postgres database mutually wipe each other's schedules on every boot, since neither declares the other's names.

This is also hit by the dev watcher: `dev/devWatcher.ts:379` calls `startCronRuntime(..., { development: true })` on every cron-array edit, re-running the same destructive reconcile.

## Recommendation

Scope the reconcile to schedules this deployment owns rather than to the whole schema: reconcile against the full declared set (`jobs`, before the `dev` filter) so a dev-skipped job is merely not *worked* locally instead of unscheduled, and skip the unschedule sweep entirely when `opts.development` is true. For multi-app isolation, namespace the cron schema per app (e.g. `mochi_cron_<appId>`) or persist an owner tag per schedule and only unschedule rows matching this app.

## Revalidation

**Verdict:** true-positive

Verified at every link. queue.ts:938 computes `active` by dropping dev-skipped jobs, 966 builds `declaredQueues` from `active` alone, and 967-971 unschedules every schedule returned by `boss.getSchedules()` that is not in that set. I checked bun-boss: `getSchedules()` with no arguments issues `SELECT * FROM <schema>.schedule ORDER BY name, key` (node_modules/bun-boss/src/plans.ts:971-973 via timekeeper.ts:209), so it returns every schedule in the fixed `mochi_cron` schema with no owner filter — the reconcile's notion of 'no longer declared' is evaluated against a store the docs explicitly tell you to share. docs/118-scheduled-jobs.md confirms both preconditions: the warning callout instructs multi-node deployments to 'point `cronStorage` at shared storage — Postgres, or a SQLite file on a shared volume', the options list defines `dev: false` as merely 'skip the job when `development: true`', and the reconcile is described as removing 'any schedule **it manages**' — an ownership scope the implementation does not have. Both failure modes hold: a `development: true` boot against shared storage unschedules exactly the `dev: false` production jobs fleet-wide (and dev/devWatcher.ts:379 re-runs the same destructive reconcile with `development: true` on every cron-array edit), and two distinct Mochi apps sharing one Postgres database mutually wipe each other's schedules on every boot — that second case needs no misconfiguration at all, since `CRON_SCHEMA` is a hard-coded constant. The failure is silent (an `unschedule` call, no error) and durable until a declaring boot re-registers. HIGH_BUG is justified by the no-misconfiguration multi-app case plus the silent, persistent loss of scheduled work.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-26)
