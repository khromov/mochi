# [BUG] Cron handler edits silently never take effect in dev — the reload signature ignores the job's run function

**File:** [`packages/mochi/src/dev/devWatcher.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/devWatcher.ts#L348-L383) (lines 348, 369, 372, 383)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`reconcileCron` (L369-388) short-circuits whenever `cronSignature(cron) === lastCronSignature`, and `cronSignature` hashes only `[name, schedule, options.tz, options.dev]` (cron.ts:78-79) — deliberately not the `run` function. `startCronRuntime` is the only path that registers handlers with the scheduler (queue.ts:933), so when a developer edits a cron job's body, the signature is unchanged, `startCronRuntime` is never re-called, and the scheduler keeps executing the closure captured at boot. The job silently runs stale code for the rest of the session with no warning — note that `reloadImage`, immediately below, does warn for its boot-only fields (L394-396).

This contradicts both the documentation and the surrounding behaviour: `packages/docs/118-scheduled-jobs.md:114` tells users "In development, editing the `cron` array re-registers on save — no dev-server restart needed", and route handlers (`Mochi.api`, `serverProps`, `actions`, ws/sse) *are* hot-swapped in `applyRouteChanges`. A developer iterating on a cron job sees their saves apply everywhere except in the job itself, which is a very expensive debugging trap (and actively misleading if the job writes to a database or sends mail).

## Recommendation

Either include a cheap identity of each `run` function in the signature (e.g. `String(j.run).length`/a hash of its source, acknowledging it is heuristic), or always re-register when the entry rebuilt and the cron array is non-empty, or — cheapest and honest — log a one-time warning from `reconcileCron` when the signature matched but the entry was re-imported ("cron handlers are not hot-swapped; restart to apply handler edits") and say so in `118-scheduled-jobs.md`.

## Revalidation

**Verdict:** true-positive

Confirmed on both halves of the chain. `cronSignature` (cron.ts:78-79) hashes `JSON.stringify(jobs.map(j => [j.name, j.schedule, j.options?.tz ?? null, j.options?.dev ?? true]).sort())` — the `run` function is deliberately excluded — and `reconcileCron` (devWatcher.ts:369-388) returns early whenever that signature is unchanged. I then verified that re-registration is the only way a new handler can take effect: `startCronRuntime` (queue.ts:933+) is the sole path that registers handlers, and it does so via `await boss.work(queueName, cronWorkOptions, cronWorkHandler(job))`, where the handler closes over the `job` object and therefore over that build's `job.run`. Since `buildEntry` re-imports the entry fresh (`extractServeOptions(outFile, { fresh: true })`) but the new job objects never reach `startCronRuntime` when the signature matches, the scheduler keeps executing the closure captured at boot — against the *old* module instance's state — for the rest of the session. The contrast the finding draws is real: `reloadImage` immediately below does warn for its boot-only fields (L390-400), route handlers are genuinely hot-swapped in `applyRouteChanges`, and `packages/docs/118-scheduled-jobs.md:114` tells users 'In development, editing the `cron` array re-registers on save — no dev-server restart needed', which a developer will read as covering handler edits even though strictly it says 'array'. Silent staleness with no warning is an expensive debugging trap and actively dangerous when the job writes a database or sends mail. Correctly filed as BUG; the cheapest honest fix is the one-time warning plus a docs clarification.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
