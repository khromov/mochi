# [MEDIUM] WebSocket upgrades are accepted with no Origin validation (cross-site WebSocket hijacking)

**File:** [`packages/mochi/src/Mochi.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/Mochi.ts#L1262-L1310) (lines 1262, 1296, 1310)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `csrf`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `Mochi.ws()` route handler (L1262-1328) calls `buildRequestContext(req, server, { kind: 'ws', pattern })`, and `runtime/requestSetup.ts:66` sets `ws: { csrf: false }`. Even if it were `true`, `csrfCheckDefault` would pass: a WebSocket handshake is a `GET`, and `DEFAULT_PROTECTED_METHODS` is `POST/PUT/PATCH/DELETE`. The handshake then reaches `server.upgrade(req, {...})` (L1310) with the victim's cookies attached and no comparison of `Origin` against `resolveExpectedOrigin()`.

Browsers do not apply the same-origin policy or CORS preflights to WebSockets, so `new WebSocket('wss://victim-app/ws/chat')` from any attacker-controlled page connects as the logged-in victim, and the attacker's JS can both send frames and read every frame the server pushes. The framework's own documentation routes authentication straight into this hole: `100-websocket-routes.md` tells users to "Reject unauthenticated sockets in `upgrade`, not `message`" and advertises that "`getRequestContext()` works inside `upgrade`, so **cookies** and `getClientAddress()` are available there". Cookie-based auth in `upgrade` succeeds for a cross-origin attacker, so the documented pattern produces a confused-deputy socket. Nothing else in the pipeline compens— `handle` middleware is documented as not running for WS upgrades, and the CSRF subsystem silently exempts the kind without noting the consequence.

## Recommendation

Validate the handshake `Origin` against `resolveExpectedOrigin(req, url, options.proxy)` (plus `csrf.trustedOrigins`) before calling `server.upgrade`, rejecting with 403 on mismatch or absence — the same resolution the CSRF check already uses, so proxy-aware deployments keep working. Make it the default with an explicit opt-out (`Mochi.ws({ checkOrigin: false })`) for non-browser clients, and document the requirement next to the existing 'reject unauthenticated sockets in upgrade' callout.

## Revalidation

**Verdict:** true-positive

Verified. The `Mochi.ws()` handler (Mochi.ts:1262-1328) calls `buildRequestContext(..., { kind: 'ws' })`, and `KIND_POLICY.ws` sets `csrf: false` (requestSetup.ts:66). Even with csrf enabled, `csrfCheckDefault` would pass: it returns `null` unless the method is in `DEFAULT_PROTECTED_METHODS` (POST/PUT/PATCH/DELETE) *and* the content type is form-like (csrf.ts:126-131), and a WebSocket handshake is a GET. The handshake then reaches `server.upgrade(req, {...})` at 1310 with the victim's cookies attached and no comparison of `Origin` against `resolveExpectedOrigin()`. The route is matched by Bun's router, so `composedFetch` (the one other `csrfCheck` call site) never sees it either. Browsers apply neither same-origin policy nor preflight to WebSockets, so `new WebSocket('wss://victim/ws/chat')` from any attacker page connects as the logged-in victim with full bidirectional access — textbook cross-site WebSocket hijacking. The documentation steers users straight into it: docs/100-websocket-routes.md:73 says 'Reject unauthenticated sockets in `upgrade`, not `message`', and :81 says 'getRequestContext() works inside `upgrade`, so cookies and getClientAddress() are available there' — cookie auth in `upgrade` succeeds for a cross-origin attacker. The doc's own code sample happens to use a custom header (`x-user-id`), which a browser cannot set on a WS handshake, so the example itself is safe; the hazard is the cookie path the prose advertises. MEDIUM is right: no framework-side mitigation exists, but exploitation depends on the app choosing cookie-based auth in `upgrade`.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
