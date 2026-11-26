# [MEDIUM] Public SSE route has no rate limit or connection cap, and fans out O(connections) work per queue event

**File:** [`packages/site/src/demos/queue/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/queue/routes.ts#L30-L35) (lines 30, 33, 35)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The page route deliberately rate-limits its enqueue POST (L13), but the sibling SSE route '/demos/queue/events' (L30) has no limit of any kind, and none is possible: `MochiSseConfig` (packages/mochi/src/types.ts L250-253) exposes no `rateLimit` field, and `resolveLimiter`/`checkRouteLimit` in Mochi.ts are invoked only from the `isMochiPage` (L889/981) and `isMochiApi` (L1198/1211) branches — the SSE registration path (L1330-1434) never consults a limiter, so even a serve-level global `rateLimit` would not apply. packages/site/src/index.ts sets no global `rateLimit` anyway. Any unauthenticated client can therefore hold an unbounded number of concurrent streams. Each connection costs three handlers appended to the process-global `mochiEvents` emitter plus a retained ReadableStream, and every queue event then runs `push` once per connection — each invocation calling `queueStatus()` (which copies and reverses the processed array) plus `JSON.stringify` plus a frame enqueue. One enqueue produces two events (queue:added, queue:completed), so with N held streams a single POST costs 2N serializations and 2N frame enqueues. Because a stalled reader never drains, `controller.enqueue` also buffers frames in each stream's internal queue, giving per-connection memory growth an attacker controls by simply not reading. The amplification is unauthenticated and asymmetric: cheap to create, server-side cost scales with N.

## Recommendation

Cap concurrent subscribers in the handler, since the framework cannot express it: keep a module-level connection counter, increment on open and decrement in `stream.onClose`, and `stream.close()` immediately (or return before subscribing) once a ceiling is exceeded. Better, register a single shared bus listener that broadcasts to a Set of active streams, so per-event cost stays O(1) in bus work and `queueStatus()`/`JSON.stringify` run once per event rather than once per connection. Consider adding `rateLimit` support to `MochiSseConfig` so SSE routes can be limited like pages and APIs.

## Revalidation

**Verdict:** true-positive

Every mechanical claim checks out. `MochiSseConfig` (types.ts L250-253) carries only `__mochiSse` and `handler` — there is no `rateLimit` field, so the route cannot declare one. I traced the limiter wiring in Mochi.ts: `resolveLimiter()` is called in exactly two places, the `isMochiPage` branch (L889) and the `isMochiApi` branch (L1198), and `checkRouteLimit()` only at L981 and L1211. Because `buildLimiter()` — the only path that instantiates the serve-level `options.rateLimit` into `sharedGlobalLimiter` — is reached solely through `resolveLimiter()`, a global `rateLimit` genuinely would not cover SSE either; and packages/site/src/index.ts sets none. The SSE registration path (L1336-1433) never consults `routeLimiters`, and `KIND_POLICY.sse.timeout === true` causes `server.timeout(req, 0)` in requestSetup.ts L85-87, so Bun's per-request idle timeout is explicitly disabled for these streams. The site's `protection` gate only matches `/demos/protection*`, CSRF is off for `sse` kind, and the page route's limiter is `skip`-scoped to POST, so an unauthenticated client can open arbitrarily many `GET /demos/queue/events` streams (the path is not slash-mirrored for SSE, so the exact URL matches). Each one appends three handlers to the process-global mitt emitter plus a retained ReadableStream, and `push` calls `queueStatus()` (array copy + reverse) and `JSON.stringify` once per connection per event; one enqueue emits `queue:added` and `queue:completed`, so the cost is 2N. Per spec, `controller.enqueue` appends regardless of `desiredSize`, so a non-reading client also grows its stream's internal queue. Concrete attack: hold N streams from a script (no browser 6-per-host limit), then spend the 60/min POST quota — server work scales linearly in N with nothing in the app or framework to bound N. MEDIUM is appropriate for an unauthenticated, uncapped streaming endpoint with O(N) fan-out on a deployed site.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
