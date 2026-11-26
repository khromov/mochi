# [HIGH_BUG] errorRate counts only transport failures, so the verdict's error gate cannot fire on any HTTP error status

**File:** [`packages/mochi/scripts/leak/runLeakTest.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/runLeakTest.ts#L167) (lines 167)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L167 computes `errorRate = stats.totalErrors / (stats.totalRequests + stats.totalErrors)`. In `loadGen.ts`, `totalErrors` is incremented only in the `catch` around `fetch` (L127-128) — i.e. transport/abort failures. Any response that arrives, including 403, 404 and 500, takes the success path: it is bucketed into `status4xx`/`status5xx` (L116-121) and increments `totalRequests` (L122), leaving `totalErrors` untouched.

So `errorRate` is structurally 0 for a server that returns 500 on every single request, and `judge`'s `if (input.errorRate > 0.005)` gate (`analyze.ts:134`) can never fire on HTTP errors. The README states the harness 'Also fails on: error rate > 0.5%', which is not what the code does. Combined with the two coverage defects above, this is why a run in which effectively all traffic is redirects, 403s and 404s still exits 0 with verdict PASS. For a harness intended as a regression gate, silently passing a wholly broken server is the worst available failure mode.

(`printReport` does emit per-route `2xx/3xx/4xx/5xx` columns, so the information reaches the console — but nothing in the verdict, the reasons list, or the exit code consumes it.)

## Recommendation

Fold HTTP error statuses into the verdict. Sum `status5xx` across routes and fail on any non-zero count; separately fail when `status4xx` or `status3xx` exceed a per-route expectation (the `page:error-404` and `unmatched:404` fixtures legitimately expect 4xx, so carry an `expectStatus` field on `RouteHit` and compare against it). Keep `totalErrors` as the distinct transport-error signal, and surface both in `VerdictInput` rather than collapsing them into one `errorRate`.

## Revalidation

**Verdict:** true-positive

Verified line by line. In `loadGen.ts`, `stats.totalErrors` is incremented at exactly one site — L128, inside the `catch` around `fetch` — and that catch is only reachable for transport/abort failures. Any response that arrives takes the success path: L113-121 bucket it into `status2xx/3xx/4xx/5xx`, L122 increments `totalRequests`, and `totalErrors` is never touched. `runLeakTest.ts:167` then computes `errorRate = totalErrors / (totalRequests + totalErrors)`, so the ratio is structurally 0 for a server answering 500 on every request. I grepped for every consumer of `status5xx`: only `report.ts` (`summarizeWorkload` L63-65, `printReport` L107) reads it, purely for display. `VerdictInput` in `analyze.ts:74-80` has no status fields at all, so `judge`'s `if (input.errorRate > 0.005)` gate (analyze.ts:134) can only ever fire on transport failures. The README (L77) explicitly promises 'Also fails on: error rate > 0.5%', which the code does not deliver for HTTP errors. This is not merely theoretical: because of F4 and F5, roughly 68% of the default workload is 301/308 redirects and another ~4% is 404s, all of which land in `status3xx`/`status4xx` and count as successes, so `errorRate` is 0 and the run exits 0. HIGH_BUG is the right severity for a CI regression gate that cannot distinguish a wholly broken server from a healthy one. The recommendation (surface 5xx separately, carry an `expectStatus` per `RouteHit` since `page:error-404` and `unmatched:404` legitimately expect 4xx) is sound.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
