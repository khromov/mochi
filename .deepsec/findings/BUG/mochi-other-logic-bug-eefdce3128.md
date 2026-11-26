# [BUG] Sitemap fetch ignores res.ok, turning the load loop into an unthrottled single-URL flood

**File:** [`memtest/driver.ts`](https://github.com/khromov/mochi/blob/main/memtest/driver.ts#L82-L128) (lines 82, 111, 118, 128)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`fetchSitemapPaths()` never checks `res.ok` — it calls `res.text()` unconditionally and regex-scans for `<loc>`. If `/sitemap.xml` answers non-2xx (a 500 from `buildSitemapXml()`, a 404 after a route rename, or the framework error page), the body contains no `<loc>` elements, so `paths` is `[]` and no exception is thrown. `runPool([])` then computes `Math.min(CONCURRENCY, 0 || 1)` = 1 worker whose `while (idx < 0)` is immediately false, so it returns instantly. Back in `loadLoop`, the `catch` block (the only place with a 2s backoff) never fires because nothing threw, and `LOOP_DELAY_MS` defaults to 0 — so the loop immediately re-fetches `/sitemap.xml` with no delay, forever. The multi-day harness silently stops exercising every doc/demo URL (its entire purpose) and instead hammers one route as fast as the network allows, while `log('load loop: completed pass N (0 urls/pass)')` fires every 10 passes, flooding `docker logs`. Any heap growth the snapshots then show reflects this pathology, not a real regression.

## Recommendation

In `fetchSitemapPaths()`, `throw new Error(...)` when `!res.ok` so the existing `catch` + 2s backoff engages. Additionally treat an empty `paths` array as an error (log it and sleep) rather than completing a pass, and give `loadLoop` an unconditional minimum delay.

## Revalidation

**Verdict:** true-positive

Traced the control flow exactly as described. `fetchSitemapPaths()` (driver.ts:81-96) calls `res.text()` with no `res.ok` guard, then regex-scans for `<loc>`; a non-2xx body (a 500 from `buildSitemapXml()`, or the framework error page) contains none, so `paths` is `[]` and nothing throws. `runPool([])` computes `Math.min(CONCURRENCY, paths.length || 1)` = `Math.min(8, 1)` = 1 worker, whose `while (idx < paths.length)` is false on entry, so it resolves immediately. Back in `loadLoop` (line 114-132) the `catch` — the only site with a 2 s backoff — never fires, and `LOOP_DELAY_MS` is `Number(process.env.LOOP_DELAY_MS) || 0`; I confirmed neither `memtest/run.sh` nor `memtest/loop.sh` ever sets it, and `run.sh` passes only `PORT` and `MEMTEST_GIT_SHA` into the container. So the loop re-fetches `/sitemap.xml` with zero delay, forever, and `log('load loop: completed pass N (0 urls/pass)')` fires every 10 passes — a genuine log flood at that iteration rate. The site registers `/sitemap.xml` as a `Mochi.api()` route with no `rateLimit`, and `Mochi.serve()` sets no global limit, so nothing throttles it. One small correction to the description: the requests are serial (one awaited `fetch` per iteration), not concurrent, so 'as fast as the network allows' is a serial hot loop rather than a parallel flood — that does not change the outcome. The substantive consequence is right: the multi-day harness silently stops exercising its URL inventory and any heap trend the snapshots show would reflect the degenerate workload. BUG is the correct severity — this is ops tooling, not production code.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-16)
