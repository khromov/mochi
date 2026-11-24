# [BUG] stopProfiler double-stop race and permanently stuck session after a failed start

**File:** [`packages/site/src/lib/profiler.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/profiler.ts#L8-L24) (lines 8, 11, 18, 24)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Two defects in the singleton lifecycle. (1) `stopProfiler()` checks `!session` at line 18 and then awaits `Profiler.stop`; two concurrent calls both pass the check, and the second proceeds to `session.post('Profiler.disable')` and `session.disconnect()` on a session the first has already disconnected and nulled — a rejected promise surfacing as a 500, and a double `disconnect()`. (2) `startProfiler()` assigns `session` at line 11 *before* awaiting `Profiler.enable`/`Profiler.start` at lines 13-14. If either post rejects, `session` is left non-null but never started, so line 8 makes every subsequent `start` a silent no-op and every `stop` either throws or returns nothing useful — the profiler is wedged until the process restarts, with no error surfaced after the first failure.

## Recommendation

Wrap both functions in a single in-flight promise (a module-level `pending` guard) so concurrent start/stop calls serialize, and null `session` in a `catch` inside `startProfiler` so a failed enable/start does not leave the module in a permanently no-op state. A small explicit state enum (`idle | starting | running | stopping`) is clearer than inferring state from `session != null`.

## Revalidation

**Verdict:** true-positive

Both defects are unambiguous in the 26-line module. (1) Double-stop: `session` is a module-level binding, re-read at each reference rather than captured. `stopProfiler` guards on `!session` at L18, then `await`s `session.post('Profiler.stop')` at L21. Two overlapping calls both pass the L18 guard before either suspends; the first resumes, runs `Profiler.disable`, `disconnect()`, and sets `session = null` at L24. The second then resumes and evaluates `session.post('Profiler.disable')` at L22 against the now-null binding — a synchronous `TypeError` inside the async function, which the `Mochi.api` wrapper turns into a 500 — and had the ordering interleaved differently it would double-`disconnect()` the same Session. (2) Failed-start wedge: L11-L12 assign and connect before the awaits at L13-L14. If `session.connect()` throws or either `post` rejects, the rejection propagates but `session` is left non-null and un-started, so the L8 early return makes every later `startProfiler()` a silent no-op and every `stopProfiler()` either rejects from `Profiler.stop` on an unstarted profiler or returns an undefined `profile` — recoverable only by restarting the process. Neither path has a `try/catch`, an in-flight promise, or a state flag. I am keeping BUG severity rather than raising it: reachability is bounded by the same `profilerEnabled()` gate I validated for F1, and the sole caller (`scripts/flamegraph.ts:199,214`) is strictly sequential and awaits each response, so nothing in the repo triggers the race today. It is a real latent robustness defect in dev tooling, not a security issue.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
