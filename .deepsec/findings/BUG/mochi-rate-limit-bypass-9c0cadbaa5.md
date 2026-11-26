# [BUG] /__mochi_live_reload is registered even when liveReload is false, accepting unauthenticated, untracked, unbounded WebSocket upgrades

**File:** [`packages/mochi/src/dev/devWatcher.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/devWatcher.ts#L152-L821) (lines 152, 635, 738, 821)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`startDevWatcher` injects `'/__mochi_live_reload': liveReloadHandler` into the Bun route table unconditionally (L818-824, and again at L635 and L738 on every entry/public reload). It never consults `options.liveReload`, while the matching WebSocket handler set is registered only `if (liveReloadEnabled)` (Mochi.ts:1954). `types.ts:480-484` documents `liveReload: false` as the way to "keep the debug bar without the socket, for production-like deployments where `/__mochi_live_reload` is flaky behind a proxy" — exactly the configuration the deployed image uses (`ENV MOCHI_LIVE_RELOAD=false`, read as `liveReload: false` in `site/src/index.ts:166` and `demos/src/index.ts:21`).

The result on the deployed, dev-mode sites: the endpoint is live and `srv.upgrade()` still succeeds (both apps declare `Mochi.ws()` routes, so `websocketOption` exists), but `wsHandlersMap` has no entry for the pattern — so `open`/`close` are no-ops (`wsHandlersMap.get(...)?.open?.(ws)`). Every accepted socket is therefore orphaned: never added to `liveReloadClients`, never closed by the application, never answered. Bun's `idleTimeout` (30s on site) is the sole bound, so an unauthenticated client that sends one frame every ~20s holds arbitrarily many sockets open — each frame reaching a no-op handler. The route is registered directly into `bunRoutes` rather than through `registerRoutePattern`, so it gets no rate limiter, no protection gate and no CSRF, and `silenceInternalRoutes` drops its `ws:message` log lines, so the abuse is both uncounted and unlogged. In the reverse configuration (an app with `liveReload: false`, dev mode and no `Mochi.ws()` routes) `websocketOption` is undefined and `srv.upgrade()` throws, turning the same route into a 500-on-demand.

## Recommendation

Pass `liveReloadEnabled` into `DevWatcherDeps` and register `'/__mochi_live_reload'` only when it is true (all three call sites: L635, L738, L821); when it is false, omit the key entirely. As defence in depth, have `liveReloadHandler` return 404 when no handler is registered for the pattern, and cap `liveReloadClients`.

## Revalidation

**Verdict:** true-positive

The registration defect is verified and unambiguous. `grep liveReload` across devWatcher.ts shows the file never reads `options.liveReload`, and `'/__mochi_live_reload': liveReloadHandler` is injected into the Bun route table at L635, L738 and L821 unconditionally, while Mochi.ts:1954 populates `wsHandlersMap` for that pattern only `if (liveReloadEnabled)`. With `development: true, liveReload: false` — precisely the deployed configuration, since the Dockerfile sets `MOCHI_LIVE_RELOAD=false` and site/demos map that to `liveReload: false` — the endpoint is live but unwired. For `packages/site` the upgrade genuinely succeeds (`websocket: { maxPayloadLength, idleTimeout: 30 }` is passed and chat/streams/cron declare `Mochi.ws()`, so `websocketOption` is the full dispatcher), and the orphaning claim holds exactly: `wsHandlersMap.get('/__mochi_live_reload')` is undefined, so `open`/`close` no-op and the socket never enters `liveReloadClients`. I also confirmed the reverse configuration is reachable — `packages/demos` declares only `Mochi.page`/`Mochi.api`/`Mochi.sse` (no `Mochi.ws`) and passes no `websocket` option, so on the deployed demos host `websocketOption` is undefined and the handler calls `srv.upgrade()` on a server with no WebSocket config; Bun's published docs only specify the true/false return, so whether that 400s or 500s I could not settle without running code, and I did not. I am downgrading from MEDIUM because the security framing does not survive scrutiny: `checkRouteLimit` is invoked only on the page (Mochi.ts:981) and api (1211) paths, so every user `Mochi.ws()` route is equally unmetered, and an attacker on `packages/site` can hold just as many sockets on `/demos/chat`. There is no limit or privilege actually being bypassed that the app's own ws surface does not already offer, and `idleTimeout` bounds idle sockets. What is real is the bug: the documented way to disable live reload leaves a half-wired endpoint that accepts upgrades doing nothing, and the fix (thread `liveReloadEnabled` into `DevWatcherDeps` and omit the key) is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
