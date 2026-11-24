# [BUG] CLI numeric arguments are unvalidated, so a typo yields a bogus verdict instead of an error

**File:** [`packages/mochi/scripts/leak/runLeakTest.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/runLeakTest.ts#L36-L40) (lines 36, 37, 38, 39, 40)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`parseCliArgs` coerces every numeric flag with bare `Number()` and never checks the result (L37-41). `--duration=abc` produces `NaN`, which flows into `durationMs: NaN` (L130) and makes `loadGen`'s `endAt = Date.now() + NaN` NaN, so `Date.now() < endAt` is false on the first iteration and every worker exits immediately with zero requests. `trimMs` (L146) becomes NaN, so the `workloadSamples` filter (L148) matches nothing. The run then proceeds through `judge` with an empty sample set and prints a verdict — most likely PASS — rather than reporting the bad input. `--port=abc` similarly yields fetches against `http://127.0.0.1:NaN`.

## Recommendation

Validate each parsed value: require `Number.isFinite` and a positive value (and for `port`, an integer in 1-65535), and throw with the offending flag name otherwise. A small `requirePositiveInt(name, raw)` helper covers all five.

## Revalidation

**Verdict:** true-positive

Verified. `parseArgs` is called with `strict: true` but every numeric option is declared `type: 'string'`, so strictness validates flag names and shapes only, never numeric content. L37-41 then coerce with bare `Number()` and nothing checks the result. I traced `--duration=abc` all the way through: `duration: NaN` → `durationMs: NaN` at L130 → `endAt = Date.now() + NaN = NaN` at loadGen.ts:82 → `Date.now() < NaN` is false, so every one of the 13 workers exits on its first loop test with zero requests. L146 `trimMs = Math.min(30_000, Math.floor(NaN/4))` = NaN (Math.min propagates NaN), so `trimStart` is NaN and the L148 filter `s.t >= NaN` matches nothing — `workloadSamples` is empty. Crucially the run does NOT bail: `rssSamples` is non-empty because the 60s default warmup already ran the poller, so the L150 throw is skipped; baseline and final probes both succeed so L153 is skipped; L156 only warns. `judge` then gets an empty sample array — `leastSquares` returns all zeros, `workloadSamples.length >= 5` is false so the monotonic-growth gate is skipped, `errorRate` is 0 (both totals are 0), and `latencyCreepPct` is 0 (firstWindow.p95 === 0). Verdict: PASS, exit 0. One correction: `--port=abc` is less silent than implied — `PORT="NaN"` reaches the site, where `Number(process.env.PORT) || 3333` falls back to 3333, so the readiness fetch to `http://127.0.0.1:NaN` fails until the 30s `bootTimeoutMs` and `startServer` throws. The finding only claims the NaN fetch URL, which is literally accurate. BUG is the right severity for operator-error robustness in a dev script.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
