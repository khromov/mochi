# [BUG] `/__mochi/health/memory` is unauthenticated, has no `development` guard, and forces a blocking full GC per request

**File:** [`packages/mochi/src/Mochi.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/Mochi.ts#L1816-L1818) (lines 1816, 1817, 1818)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `public-endpoint`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L1816-1823 registers `/__mochi/health/memory` whenever `process.env.MOCHI_MEMORY_PROBE === '1'`. Unlike every other internal route in this file (`buildClientStatsRoutes`, `buildPageCacheAdminRoutes`, `buildEmailViewerRoutes` at L789-791 are all behind `debugBarEnabled`/`emailViewerEnabled`, which are themselves `development && ...`), this one has no `development` check, no auth, no rate limiting, and does not go through `buildRequestContext` (so neither the `protection` gate nor middleware applies).

The handler calls `Bun.gc(true)` — a synchronous, full, non-incremental heap collection on Bun's single JS thread — before returning `process.memoryUsage()`. Any unauthenticated client can therefore (a) stall the event loop on demand, so a trivial request loop against this one path becomes a cheap, highly amplified DoS against the whole server regardless of how well other routes are rate-limited, and (b) read RSS/heap/external figures, which leak deployment size and are a useful oracle for memory-exhaustion probing. The repo's own `Dockerfile.memtest:53` ships `ENV MOCHI_MEMORY_PROBE=1`, showing the variable does travel in images, and `scripts/leak/serverProcess.ts:57` uses the endpoint as a readiness probe — making it plausible for the flag to survive into a real deploy.

## Recommendation

Gate the probe on `development && process.env.MOCHI_MEMORY_PROBE === '1'`, as every other internal route is gated, or require a secret token compared with `timingSafeEqual`. At minimum, decouple the measurement from the collection (don't run `Bun.gc(true)` on an attacker-triggered path — or bound it with a cooldown) and run it through `buildRequestContext` so the protection gate and rate limiter apply.

## Revalidation

**Verdict:** true-positive

Every code claim checks out. Mochi.ts:1816-1823 registers `/__mochi/health/memory` on `process.env.MOCHI_MEMORY_PROBE === '1'` alone, as a bare handler: it does not go through `buildRequestContext`, so neither the protection gate nor middleware nor any rate limiter applies, and it calls `Bun.gc(true)` — a synchronous full collection on Bun's single JS thread — before returning `process.memoryUsage()`. The asymmetry the finding highlights is real: every sibling internal route is `development && …` (`debugBarEnabled` at 503 for buildClientStatsRoutes/buildPageCacheAdminRoutes, `emailViewerEnabled` at 619 for the email viewer), while this one has no mode check at all. Downgrading MEDIUM→BUG on reachability, which I checked rather than assumed: a repo-wide grep shows `MOCHI_MEMORY_PROBE=1` is set in exactly one place — `Dockerfile.memtest:53`, a dedicated memory-regression harness image that runs `NODE_ENV=development` and is described as 'intended for an unattended multi-day run on a dedicated box'. It is not the deploy image (`Dockerfile` / `Dockerfile.production`), appears in no `.env.example`, and the project's own notes list `MOCHI_MEMORY_PROBE` among the flag-gated dev surfaces. So the finding's 'plausible for the flag to survive into a real deploy' is a stretch: reaching the exposure requires an operator to deliberately set a non-default diagnostic env var in production. It remains a genuine hardening gap worth fixing (add `development &&`, or decouple the forced GC from the measurement), just not a MEDIUM-severity exposure in anything the project ships.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
