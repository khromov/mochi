# [MEDIUM] Source fetch buffers the whole body in memory with no concurrency or total-cache cap, on a route that bypasses the rate limiter

**File:** [`packages/mochi/src/image/fetchSource.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/fetchSource.ts#L71-L135) (lines 71, 121, 127, 135)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-resource-exhaustion`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`readWithMaxSize` accumulates every chunk into a `chunks` array and then calls `Buffer.concat(chunks)`, so peak resident memory per in-flight cold fetch is roughly 2 x `maxResponseBytes` (2 x 20 MB by default) before the bytes are handed to `new Bun.Image(…, { maxPixels: 50_000_000 })` for decode. `maxResponseBytes` caps a single response, but nothing caps concurrent fetches, concurrent decodes, or the total size of the on-disk cache (`FileStorage` is created with `maxAge: timeToEvict` and `purgeInterval: 0`, with only an hourly age-based sweep — no byte budget).

This matters because the image route is a raw `bunRoutes` entry (`Mochi.ts:1707`) and Bun dispatches `routes` before `fetch`, so the handler never passes through `buildRequestContext`: no `checkRouteLimit`, no `protection` gate, no `handle` middleware. `MochiCache` coalesces concurrent requests per key, so a warm or repeated key is cheap — but every *distinct* `src` is a distinct key and therefore a distinct concurrent fetch+buffer+decode.

The docs explicitly bless minting from user input (`packages/docs/148-images.md:262`: "If you pass a user-controlled `src` into `getImageUrl()`/`getImage()`, keep `blockPrivateNetworks` on …"). In that configuration an attacker mints an unbounded number of distinct `src` values pointing at a large upstream they control, fires them concurrently, and drives both memory (N x ~40 MB plus N decodes) and disk (N x 20 MB retained for `timeToEvict`, 1 day by default) with no limit and no rate limiting to slow them down. Even without a mint oracle, the N distinct image URLs published in a site's own HTML are enough to force N concurrent cold regenerations immediately after a deploy, since `cacheDir` defaults to the ephemeral `./.mochi/image-cache`.

## Recommendation

Add a bounded concurrency gate (a semaphore around the fetch+decode path, sized from CPU/memory) so a burst of distinct cold sources queues instead of all resident at once. Stream the body to the cache's blob file instead of buffering it and then `Buffer.concat`-ing it, eliminating the 2x peak. Give the image cache a total-bytes budget in addition to `maxAge`. Where an app may mint from user input, document (and ideally enforce) that the image route be covered by a reverse-proxy or `staticDirs`-level rate limit, since it cannot be reached by `Mochi.serve({ rateLimit })`.

## Revalidation

**Verdict:** true-positive

Each mechanical claim verified. `readWithMaxSize` pushes every chunk into a `chunks` array and then `Buffer.concat(chunks)` (fetchSource.ts:127/135), so peak resident bytes per cold fetch really is ~2x `maxResponseBytes` (2x20 MB default) before the buffer reaches `new Bun.Image(input, { maxPixels })`; per Bun's own docs a decode is 4 bytes/pixel, so each concurrent decode can add up to 200 MB at the 50 MP default — if anything the finding understates the memory figure. I grepped the image and cache subsystems for any semaphore/concurrency limiter and found none: the only coordination is `MochiCache`'s per-key `inflight` Map (cache.ts:106/349) plus the cross-process `mochi:inflight:` marker, which coalesces identical keys and does nothing about distinct ones. `FileStorage` is constructed with `{ maxAge: timeToEvict, purgeInterval: 0, offloadBinary: true }` and has no total-bytes budget anywhere in cache-storage.ts — only the age-based `sweep()` the hourly janitor drives. The route-bypass claim is the strongest part and is solid: the image handler is a raw `bunRoutes` entry (Mochi.ts:1707) that never calls `buildRequestContext`, `RouteKind` has no `image` member in `KIND_POLICY`, and `checkRouteLimit` is only invoked inside the page (Mochi.ts:981) and api (1211) handlers — so this endpoint genuinely cannot be covered by `Mochi.serve({ rateLimit })` and must be fronted by a reverse proxy. The exploitability precondition is real and I want it stated plainly: an attacker cannot mint tokens, so the reachable `src` set is whatever the app published — and replaying published URLs coalesces and warms after one fetch. The unbounded-distinct-src amplification needs an app that mints from user input, which `packages/docs/148-images.md` (the danger Callout, ~line 262) explicitly blesses. That is a supported, documented configuration, and in it the attack is unbounded in memory and in retained disk (N x 20 MB for `timeToEvict`, 1 day) with no framework-level throttle available, so MEDIUM is appropriate. The 'N distinct URLs after a cold deploy' variant is self-inflicted load rather than an attack and I would not lean on it.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
