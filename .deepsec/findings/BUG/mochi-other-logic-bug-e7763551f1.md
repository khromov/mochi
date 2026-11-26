# [BUG] Latency-creep gate silently cannot fire for runs shorter than 120s

**File:** [`packages/mochi/scripts/leak/runLeakTest.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/runLeakTest.ts#L163-L165) (lines 163, 164, 165)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L163-164 compare a fixed 60s window at the start of the workload against a fixed 60s window at the end: `latenciesBetween(stats, workloadStart, workloadStart + 60_000)` versus `latenciesBetween(stats, workloadEnd - 60_000, workloadEnd)`. When `--duration` is under 120 the two windows overlap; when it is under 60 they are nearly identical, both covering the whole run. `latencyCreepPct` then approaches 0 regardless of any real creep, and `judge`'s `latencyCreepPct > 50` gate (`analyze.ts:139`) cannot fire.

The code already warns about unreliable verdicts on short runs, but only for RSS sample count (L156-160) — nothing tells the operator that one of the three fail gates has been silently disabled. A smoke run like the README's documented `--duration=120` sits exactly on the boundary.

## Recommendation

Derive the window size from the duration (e.g. `Math.min(60_000, durationMs / 4)`) and skip the creep check entirely — reporting it as 'not evaluated' in the verdict reasons — when the workload is too short for two disjoint windows.

## Revalidation

**Verdict:** true-positive

Confirmed exactly. `runLeakTest.ts:163` takes `latenciesBetween(stats, workloadStart, workloadStart + 60_000)` and L164 takes `latenciesBetween(stats, workloadEnd - 60_000, workloadEnd)`. `latenciesBetween` (loadGen.ts:49) filters `s.t >= fromMs && s.t < toMs`. For `--duration` under 60, `workloadEnd - 60_000 < workloadStart` and `workloadStart + 60_000 > workloadEnd`, so BOTH windows contain the complete sample set — they are literally identical, `lastWindow.p95 / firstWindow.p95` is exactly 1, `latencyCreepPct` is exactly 0, and the `latencyCreepPct > 50` gate at analyze.ts:139 provably cannot fire. For 60 < duration < 120 the windows overlap partially, so the signal is attenuated rather than fully suppressed — a small overstatement in the finding's framing of 'shorter than 120s', but the ≤60s case is an exact, provable dead gate. At exactly 120 (the value in the README's own flags example, L20) the windows are precisely disjoint and adjacent, so the harness sits on the boundary. The finding's observation that the code warns about short-run unreliability only for RSS sample count is also correct: L156-160 warns on `workloadSamples.length < 3` and nothing warns that a fail gate has been disabled. The default `--duration=600` is unaffected, which correctly keeps this at BUG rather than HIGH_BUG.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
