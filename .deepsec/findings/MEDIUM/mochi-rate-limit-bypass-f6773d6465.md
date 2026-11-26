# [MEDIUM] Unauthenticated /sse/time and /ws/time allocate an unbounded per-connection 1s timer that cannot be rate-limited or timed out

**File:** [`packages/site/src/demos/streams/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/streams/routes.ts#L6-L26) (lines 6, 11, 23, 26)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Both stream routes allocate a permanent `setInterval` firing every 1000ms per connection, with no cap on concurrent connections. Three framework facts make this un-mitigable at the route layer:

1. `checkRouteLimit` is called only on the `page` (Mochi.ts:981) and `api` (Mochi.ts:1211) dispatch paths. The `ws` (Mochi.ts:1262+) and `sse` (Mochi.ts:1336+) branches never call it, and `Mochi.ws(handlers)` / `Mochi.sse(handler)` accept no config object at all (Mochi.ts:227-236) — unlike `page`/`api`, which take `{ rateLimit }`. The global `rateLimit` serve option therefore cannot reach these routes either.
2. Neither branch invokes the site's `handle` chain, so no `sequence()` middleware can gate them.
3. `KIND_POLICY` in runtime/requestSetup.ts:65 sets `sse: { timeout: true }`, which runs `server.timeout(req, 0)` — Bun's "disable the idle timeout". An SSE connection is explicitly exempted from expiry. (`csrf: false` too, so no Origin check applies.)

Attack: `/sse/time` is a plain unauthenticated GET with no handshake, so `for i in $(seq 1 50000); do curl -N https://mochi.fast/sse/time & done` opens 50k never-expiring streams, each driving a 1s timer — 50k timer callbacks and enqueues per second plus 50k held sockets and ReadableStreams. A client that opens the connection and never reads compounds it: `MochiSseStream.send` calls `controller.enqueue(frame)` unconditionally with no `desiredSize`/backpressure check (Mochi.ts:1399) under the default queuing strategy, so the per-stream queue grows without bound. `/ws/time` is the same shape via `ws.send` with no return-value check and no `drain` handler; the site's `websocket: { idleTimeout: 30 }` does not help because the server writes every second, keeping the socket non-idle.

I am reporting this despite the demo-code caveat because these routes are live on a deployed site, the endpoints are cheap to attack, and the same shape is what the demo teaches readers to copy.

## Recommendation

Track live connections per route in a module-scope counter and reject past a ceiling — for SSE, return a 503 before constructing the ReadableStream; for WS, add an `upgrade(req)` handler that returns `false` (it is the one place in a socket's life with a Request and a working `getRequestContext()`). Key the ceiling on `getClientAddress()` so one peer cannot consume the pool. Separately, consider teaching the framework to run `checkRouteLimit` for the `ws`/`sse` kinds and to accept a `rateLimit` option on `Mochi.ws`/`Mochi.sse`, and have `MochiSseStream.send` drop or close when `controller.desiredSize` goes non-positive.

## Revalidation

**Verdict:** true-positive

All three framework claims are confirmed by source. (1) `checkRouteLimit` is called in exactly two places — Mochi.ts:981 (page) and Mochi.ts:1211 (api); the ws branch (Mochi.ts:1258+) and sse branch (Mochi.ts:1332+) never call it, and `resolveLimiter` is likewise only invoked in the page/api registration branches, so the global `rateLimit` serve option cannot reach these routes either. `Mochi.ws(handlers)` and `Mochi.sse(handler)` (Mochi.ts:227-236) take no config, unlike `page`/`api` which accept `{ rateLimit }`. (2) Neither branch invokes `middleware`, so no `sequence()` handle can gate them — the site's whole `handle` chain is bypassed. (3) `KIND_POLICY.sse.timeout === true` (requestSetup.ts:65) runs `server.timeout(req, 0)` (requestSetup.ts:85-87); the framework's own docs confirm the intent — 'Mochi already disables the idle timer for page renders and SSE streams' (packages/docs/160-serve-options.md:128). I also verified `MochiSseStream.send` calls `controller.enqueue(frame)` unconditionally with no `desiredSize` check (Mochi.ts:1398), and the stream is constructed with the default count-based queuing strategy, so a client that holds the connection open without reading grows the per-stream queue without bound while the disabled idle timer guarantees the socket never expires; `/ws/time` has the same shape via `ws.send` with no return-value check and no `drain`, and `websocket: { idleTimeout: 30 }` cannot help because the server writes every second. Unlike F5's per-request CPU, these are persistent per-connection resources — one 1 Hz timer, one never-expiring socket and one monotonically growing queue each — with no cap at any layer and no route-level knob to add one, which is the same 'unbounded resource growth on public demo routes' class commit 1289d8f8 treated as a security fix for the chat and HN caches. MEDIUM stands. The recommendations (a module-scope connection ceiling keyed on `getClientAddress()`, 503 before constructing the stream, `upgrade()` returning false for ws, and a `desiredSize` check in `MochiSseStream.send`) are all sound; note `upgrade` is confirmed to be the one callback with a working `getRequestContext()` (Mochi.ts:1294-1297).

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
