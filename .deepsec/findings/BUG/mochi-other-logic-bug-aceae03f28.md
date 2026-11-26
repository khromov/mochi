# [BUG] `cronSignature` omits the handler, so editing a cron handler body in dev keeps running the stale closure

**File:** [`packages/mochi/src/cron.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cron.ts#L78-L79) (lines 78, 79)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`cronSignature` fingerprints a cron array as `[name, schedule, tz, dev]` only (L78-79). The dev watcher short-circuits on an unchanged signature: `dev/devWatcher.ts:371-374` computes `cronSignature(cron)` and `return`s without touching the scheduler when it matches. Because the handler function is not part of the signature, a handler-body-only edit is indistinguishable from an unrelated route edit.

On save, the watcher re-imports the entry and builds fresh `MochiCronJob` objects with new closures, but `reconcileCron` skips `startCronRuntime`, so the running `boss.work(queueName, ..., cronWorkHandler(job))` registration (queue.ts:983) still holds the **old** job object. The developer sees the normal reload log and the old code keeps firing until the dev server is restarted — including after the handler is edited to fix a bug, so the fix appears not to work. The docs promise the opposite: `118-scheduled-jobs.md:114` says "In development, editing the `cron` array re-registers on save — no dev-server restart needed."

## Recommendation

Include a handler identity in the signature — e.g. append `String(j.run)` (the function source, which changes with the body) or a hash of it — so a handler edit re-registers; or have `reconcileCron` always re-register the worker handlers (cheap: `boss.work` re-registration) while keeping the schedule-churn guard keyed on the current signature.

## Revalidation

**Verdict:** true-positive

I traced the whole dev-reload path and every link in the chain holds. `cronSignature` (cron.ts:78-79) maps each job to `[name, schedule, options?.tz ?? null, options?.dev ?? true]` — the `run` handler is structurally absent, and the function's own parameter type (`{ name; schedule; options? }`) doesn't even accept it. `reconcileCron` (devWatcher.ts:369-374) computes that signature and `return`s before touching the scheduler when it matches `lastCronSignature`, which is seeded at boot from `Mochi.ts:2153`. Meanwhile `buildEntry()` does produce a genuinely fresh closure: `extractServeOptions(outFile, { fresh: true })` → `freshImport()` copies the rebuilt bundle to a uniquely *named* artifact and imports it, so the `MochiCronJob` objects (and their `run` functions) are brand new on every save. The live worker registration is unaffected: `startCronRuntime` calls `boss.work(queueName, cronWorkOptions, cronWorkHandler(job))` (queue.ts:983), and `cronWorkHandler` closes over the `MochiCronJob` object and invokes `job.run(...)` at firing time (queue.ts:898-904). That boss lives on `registry`, which is `pinGlobal('__mochi_queue_registry__', …)` (queue.ts:233-245), and the entry is rebuilt with `packages: 'external'`, so `mochi-framework` is never re-evaluated — the old boss and its old handler closure survive the reload intact. I also ruled out two plausible mitigations: `isBuildingEntry()` is `AsyncLocalStorage`-scoped (`runInEntryImportScope`), so it is already false by the time `reconcileCron` runs on line 348 and does not independently suppress re-registration; and nothing resolves the handler dynamically by job name at fire time. The trigger is real and ordinary — the site's own `packages/site/src/demos/cron/cron.server.ts` is imported via `demos/cron/routes.ts` → `src/routes.ts` → the entry, so it is in `serverEntryDeps` and a `change` on it takes the `isServerEntryDep` branch (devWatcher.ts:767-770) into `triggerEntryReload`, which emits `recompile:complete` and prints a normal-looking `HMR … rebuilt N pages, M bundles` line (consoleLogger.ts:399-412) with no cron warning. That demo makes the consequence sharper than the finding states: the `ws` handler map is hot-swapped to the *new* module's `addClient`/`clients`, while the cron keeps appending to the *old* module's `log` and broadcasting to the old `clients` set, so after one reload the firings silently reach nobody. No test references `cronSignature`/`reconcileCron`, and nothing documents the limitation — `170-development-mode.md:82` enumerates what hot-swaps (api/serverProps/actions/ws/sse) without mentioning cron, while `118-scheduled-jobs.md:114` promises save-time re-registration. The only part I'd soften is the doc-violation framing: 'editing the `cron` array' can be read strictly as adding/removing/retiming entries, which does work. Severity BUG is correct — dev-mode only, no production or security impact (no watcher in prod), and the workaround is a dev-server restart.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
