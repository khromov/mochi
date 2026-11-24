# [MEDIUM] Live-reload WebSocket upgrade accepts any Origin (dev server reachable from any website)

**File:** [`packages/mochi/src/web-components/LiveReload.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/LiveReload.ts#L76-L117) (lines 76, 92, 117)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-cross-site-websocket-hijacking`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The client opens `ws(s)://<location.host>/__mochi_live_reload?entry=<absolute page entry path>` (L71-76). On the server, that path is upgraded by `liveReloadHandler` (dev/devWatcher.ts:152-172), which calls `srv.upgrade(req, …)` without inspecting the `Origin` header, and the route is registered straight into `bunRoutes` (devWatcher.ts:635,738,821) so it never passes through `buildRequestContext` — no `csrfCheck`, no `checkRouteLimit`, no protection gate. WebSockets are exempt from the same-origin policy, so any page the developer browses can open this socket while `bun run dev` is running.

What the cross-origin page gets:
- Service fingerprinting: a successful handshake confirms a Mochi dev server on that localhost port, plus the `boot:<uuid>:<generation>` greeting (Mochi.ts:1960, dev/liveReloadGeneration.ts:32).
- A live feed of the developer's activity: every `reload` broadcast (devWatcher.ts:188) reveals each save.
- Dev-outbox email ids: `email:new:<id>` is broadcast to every connected client (Mochi.ts:1979-1987) and consumed at L117-126. The ids are the keys to `/_mochi/email/:id`; the viewer itself is not readable cross-origin (the framework sets no CORS headers), but the ids and the fact that mail is flowing leak.
- A project-path oracle: the attacker chooses the `entry` query value, and `liveReloadGreeting(entry)` returns `unscopedReloads + (scopedReloads.get(entry) ?? 0)` — comparing a guessed absolute source path's generation against the unscoped baseline reveals whether that file exists in the developer's tree and has been edited.
- `liveReloadClients` is an unbounded `Set` with no connection cap, so a hostile page can also exhaust sockets/memory on the dev server.

Scope is development only: `liveReloadEnabled = options.liveReload ?? development` (Mochi.ts:504), and this repo's deployed dev-mode image sets `MOCHI_LIVE_RELOAD=false` (Dockerfile), which `packages/site` honours. But types.ts:482 documents `liveReload: false` as something you opt into "for production-like deployments", implying the socket is otherwise live in any `development: true` deployment.

Note: the scanner's "postMessage handler WITHOUT origin validation" hits at L92 and L231 are false positives — L92 is `ws.onmessage` (a WebSocket frame carries no origin; the connection target is built from `location.host`, so client-side validation is not the control point) and L231 nulls the handlers. The missing check is on the server's upgrade, not here.

## Recommendation

Validate the handshake in `liveReloadHandler` before `srv.upgrade()`: reject when the `Origin` header is absent or its origin does not equal the request's own (reuse `resolveExpectedOrigin`/`buildPublicUrl` from `runtime/proxy.ts` so proxy config is honoured), returning 403. Additionally cap `liveReloadClients`, and treat the attacker-supplied `entry` param as untrusted — do not let it probe per-path reload generations (hash it, or only accept an entry the server has actually compiled).

## Revalidation

**Verdict:** true-positive

Verified end-to-end. `liveReloadHandler` (dev/devWatcher.ts:152-172) builds a URL, reads the attacker-chosen `entry` query param, and calls `srv.upgrade(req, …)` with no inspection of the `Origin` header. The route is injected straight into Bun's `routes` map (devWatcher.ts:635, 738, 821), so it never reaches `buildRequestContext` — and even if it did, `KIND_POLICY.ws` has `csrf: false`, and `csrfCheck` only gates unsafe methods, so a GET handshake would pass regardless. It also bypasses user `handle` middleware, which is only invoked at Mochi.ts:991 (page), 1240 (api) and 1922 (fallback `fetch`), and bypasses the protection gate and rate limiter. On open (Mochi.ts:1955-1964) the server immediately sends `liveReloadGreeting(client.data.__mochiEntry)`, and liveReloadGeneration.ts:31 computes `unscopedReloads + (scopedReloads.get(entry) ?? 0)` — a genuine per-absolute-path oracle driven entirely by attacker input — while `onDevEmailRecorded` (Mochi.ts:1979-1987) fans `email:new:<id>` to every socket in the unbounded `liveReloadClients` Set. So a hostile page a developer visits can complete the handshake and read save-activity timing, dev-outbox ids and the boot id. Impact is correctly bounded by the finding: `startDevWatcher` only runs when `development` is true (Mochi.ts:2151), the `message` handler answers only `ping`→`pong` so the socket is read-only, no source or file contents are exposed, and the email viewer bodies stay unreadable cross-origin — I confirmed there is not a single `Access-Control-Allow-*` header anywhere in packages/mochi/src. The deployed dev-mode image sets `MOCHI_LIVE_RELOAD=false` (Dockerfile:61), which drops the `wsHandlersMap` entry so an upgraded socket receives nothing. MEDIUM is a fair rating for a dev-host CSWSH/info-leak, and the suggested fix (compare `Origin` against `resolveExpectedOrigin`) is already available in runtime/proxy.ts.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
