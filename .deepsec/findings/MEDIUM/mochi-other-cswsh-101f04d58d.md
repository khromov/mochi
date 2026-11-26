# [MEDIUM] No Origin check on the WebSocket upgrade (cross-site WebSocket hijacking)

**File:** [`packages/site/src/demos/chat/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/chat/routes.ts#L35-L39) (lines 35, 37, 38, 39)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-cswsh`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The upgrade handler (L38-40) only derives a rate-limit key; it never inspects `Origin`. The framework does not supply one either — `KIND_POLICY` in `packages/mochi/src/runtime/requestSetup.ts:66` sets `ws: { csrf: false, … }`, so `csrfCheck` is skipped for every ws route, and Bun's `server.upgrade()` performs no origin validation. `MochiWsHandlers` has no `rateLimit` or `csrf` option, so returning `false` from `upgrade()` is the only available gate, and it is unused.

WebSocket handshakes are exempt from the same-origin policy and are not preflighted, so any third-party page a visitor loads can open `wss://<site>/ws/chat` and both read the replayed history and write into it — from the *victim's* IP address. That has two concrete consequences: (1) the per-IP 20-messages/10 s window, the only control on the shared-history poisoning described above, is trivially sidestepped by distributing writes across arbitrary drive-by visitors, and (2) abusive content injected into a buffer that is served to every visitor of the public site is attributed to victims' addresses in any upstream logs. The upgrade itself is also unbounded (no `rateLimit` on the route and no global `rateLimit` in the site's `Mochi.serve()` config), and each successful upgrade replays up to 64 KB of history, so connection churn is an amplifier as well.

## Recommendation

In `upgrade()`, compare `req.headers.get('origin')` against the expected public origin (the same value fed to `proxy.origin`) and `return false` on mismatch or absence; apply the same check to the site's other `Mochi.ws()` routes (`/ws/time`, `/ws/cron-log`). Consider having the framework run an origin check for `kind: 'ws'` by default, since `Mochi.ws` currently exposes no other hook for it.

## Revalidation

**Verdict:** true-positive

Every link in the chain checks out. `KIND_POLICY` in runtime/requestSetup.ts:66 sets `ws: { csrf: false, ... }`, so `csrfCheck` is skipped for every ws route (requestSetup.ts:119-126 is gated on `policy.csrf`); `Mochi.ws<T>(handlers)` (Mochi.ts:227-236) accepts no config object at all, so there is no `csrf` or `rateLimit` option; and Mochi.ts:1290-1305 shows `upgrade()` returning `false` is the only available rejection path — the chat's `upgrade` (routes.ts:38-40) only derives a rate key and never reads `Origin`. Bun's `server.upgrade()` performs no origin validation. WebSocket handshakes are not subject to the same-origin policy and are not preflighted, so any third-party page a visitor loads can open `wss://mochi.fast/ws/chat`, receive the replayed history, and write into the shared buffer from the victim's IP. The concrete security consequence is the one the finding names: `rateKeyFor()` keys the 20-messages/10s window on `getClientAddress()`, which behind the site's nginx (`proxy: { addressHeader: 'x-forwarded-for', xffDepth: 1 }`) resolves to the real visitor IP — so distributing writes across drive-by visitors defeats the only control on the buffer, and the content is attributed to victims' addresses upstream. I am keeping MEDIUM: this is a missing cross-origin control (CWE-1385) that bypasses another security control, and #349's own commit message states that `upgrade` 'is exactly where auth and client identity belong', confirming the hook exists and is simply unused. I note the classic CSWSH harm — cross-origin reading of cookie-authenticated data — does not apply, since the socket carries no session and the history is already public, which is why this is MEDIUM and not higher.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
