# [MEDIUM] WebSocket upgrades are entirely exempt from the Origin check (CSWSH)

**File:** [`packages/mochi/src/runtime/csrf.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/csrf.ts#L11-L26) (lines 11, 26)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-cross-site-websocket-hijacking`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

This module is the framework's only cross-origin request gate, but it can never fire for a WebSocket handshake, for two independent reasons: (1) `KIND_POLICY` in runtime/requestSetup.ts:66 sets `ws: { csrf: false }`, so `csrfCheck` is skipped for `kind: 'ws'` altogether, and (2) even if it were enabled, `DEFAULT_PROTECTED_METHODS` (L26) covers only POST/PUT/PATCH/DELETE, and a WS handshake is a GET. Browsers do NOT apply the same-origin policy to WebSocket connections — `new WebSocket('wss://target/ws/chat')` from any origin succeeds and the victim's cookies ride along on the handshake — and CORS does not apply to the socket, so the attacker's page can both read and write on it. Tracing Mochi.ts:1262-1328 confirms the upgrade path reads no `Origin` header anywhere: `buildRequestContext` runs with `kind: 'ws'`, then `upgradeHandler(req, wsParams)` is the app's own optional callback, then `server.upgrade()`. Any `Mochi.ws()` route that authorizes off a cookie (the natural pattern, since the handshake is a normal credentialed request) is therefore hijackable from any website the victim visits. This is not documented as a limitation: the module's own 'Limitations' block (L11-15) names only Origin-stripping clients and JSON endpoints, and packages/docs/100-websocket-routes.md never mentions `Origin` (grep for 'origin' in that page returns nothing), so an app author has no prompt to add the check in `upgrade`.

## Recommendation

Add an Origin check to the WS upgrade path rather than leaving it to each app: in `buildRequestContext` (or in Mochi.ts's ws `bunRouteValue`), when `kind === 'ws'`, compare `request.headers.get('origin')` against `resolveExpectedOrigin(request, url, proxy)` using the same `normalizeOrigin` + `trustedOrigins` logic, and reject the upgrade with a 403 on mismatch or on a missing Origin. Expose it as a `csrf.checkWebSocketOrigin` option (default on) so a deliberately public socket can opt out, and add the limitation to this module's doc block and to the WebSocket docs page.

## Revalidation

**Verdict:** true-positive

Both independent reasons check out. `KIND_POLICY` sets `ws: { csrf: false }` (requestSetup.ts:66), so `csrfCheck` is never invoked for a handshake, and `DEFAULT_PROTECTED_METHODS` (csrf.ts:26) covers only POST/PUT/PATCH/DELETE while a handshake is a GET — so even flipping the policy flag would not help. I traced the whole upgrade path (Mochi.ts:1262-1328): `buildRequestContext` with `kind: 'ws'`, `route:matched`, the app's optional `upgrade(req, wsParams)`, then `server.upgrade()` — the `Origin` header is never read, and a repo-wide grep for `origin` in Mochi.ts returns only the three CSRF call sites. The documentation gap is worse than stated: 100-websocket-routes.md has zero occurrences of 'origin', and it actively steers authors toward exactly the vulnerable pattern — 'Reject unauthenticated sockets in `upgrade`' (L71-75) plus '`getRequestContext()` works inside `upgrade`, so cookies … are available there' (L81). Browsers apply neither SOP nor CORS to WebSockets, so `new WebSocket('wss://target/ws/chat')` from an attacker page connects and is readable/writable. One mitigation the finding misses and that should temper the severity: because `serializeCookie` leaves `init.sameSite` unset unless the caller specifies it, Bun emits an explicit `SameSite=Lax` on every jar-set cookie, and every current browser honours an explicit Lax attribute by suppressing the cookie on a cross-site, non-top-level-navigation request — including a WS handshake. Real-world exploitability therefore needs a cookie set with `sameSite: 'none'` (plausible here: this monorepo's own newsletter widget is a cross-origin iframe), a cookie set outside the jar with no SameSite, or other ambient credentials such as cached HTTP Basic. The gap is genuine and the recommended `csrf.checkWebSocketOrigin` default-on fix is the right shape; MEDIUM is fair.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-18)
