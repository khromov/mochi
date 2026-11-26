# [MEDIUM] Server-island props tokens are non-expiring bearer capabilities carried in a query string

**File:** [`packages/mochi/src/islands/serverIslandCrypto.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/islands/serverIslandCrypto.ts#L29-L49) (lines 29, 31, 47, 48, 49)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-missing-token-expiry`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`decryptProps` validates only the AES-SIV tag and the component-name AAD (L47-49). The sealed payload has no `iat`, no TTL, and no binding to a session, user, or request — unlike the two sibling uses of the same primitive, which both seal `iat` and enforce an age bound (`captcha.ts:50` + `verifyCaptcha`'s `maxAgeMs`, `clearance.ts:13` + `hasValidClearance`). Because AES-SIV is deterministic, a given props bag yields the same token forever, for the lifetime of `MOCHI_KEY`.

The server-island endpoint is unauthenticated (`KIND_POLICY.island` in requestSetup.ts:67 disables CSRF; there is no identity check anywhere in the handler at Mochi.ts:1559-1696) and renders whatever the token says, so the token *is* the authorization for that render. It travels as `?props=<token>` on `/_mochi/island/<Name>` (ServerIsland.ts:142-150), i.e. in a URL query string — which reverse proxies, load balancers, and CDNs record in access logs by default, and which `ComponentRegistry` compiles into HTML that may be page-cached.

The natural server-island pattern makes this exploitable: `<AccountPanel mochi:defer userId={session.userId} />` or `<AdminWidget mochi:defer isAdmin />` turns into a permanent, replayable capability. Anyone who later reads an access log, a cached page, or a shared HAR file can re-render that island — including its server-only data — indefinitely and anonymously, with no way for the app to revoke it short of rotating `MOCHI_KEY` (which the boot warning in mochiConfig.ts:34-40 notes also invalidates every image URL).

## Recommendation

Seal an `iat` alongside the props (as the captcha and clearance paths already do) and reject tokens older than a configurable window in `decryptProps`, defaulting to something short enough to bound replay but long enough for a cached page's lifetime. Document that props must carry inputs, not authorization decisions, and that server islands needing per-user authorization must re-check identity from `getRequestContext()` inside the component. Consider moving the token to a POST body or header so it stops landing in query-string access logs.

## Revalidation

**Verdict:** true-positive

Confirmed by reading the endpoint end to end. `decryptProps` checks only the SIV tag and the component-name AAD (serverIslandCrypto.ts:47-49); there is no `iat`, TTL, session binding, or nonce in the sealed envelope, and AES-SIV's determinism means a given props bag yields the same token for the life of `MOCHI_KEY`. The endpoint is genuinely unauthenticated: `KIND_POLICY.island` sets `csrf: false` (requestSetup.ts:67), the handler at Mochi.ts:1559-1696 performs no identity check — it decrypts, strips `islandId`/`__mochi_ah`, compiles and renders — and unlike page and api routes it never calls `checkRouteLimit`, so the token is the sole authorization for that render and it is replayable without limit. The token travels as `?props=` in the URL (ServerIsland.ts:142-150), the canonical place reverse proxies, CDNs and load balancers log by default. The contrast the finding draws is real and I verified both halves: `captcha.ts:50` seals `{iat, nonce, bits}` and `verifyCaptcha` enforces an age window, and `clearance.ts:13`/`hasValidClearance` seal `iat` and bound it with drift tolerance — the props path alone omits this. The docs actively teach the risky shape (`<UserAvatar mochi:defer userId={123} />`, 'use it for personalized fragments') and warn only that `mochi:defer mochi:hydrate` makes props client-visible, never that props are not an authorization boundary and that tokens never expire. Mitigating facts keep this at MEDIUM rather than higher: the island render executes with the *replayer's* request context, so a replay does not impersonate a session, and whoever held the page already held the token — the incremental harm is the unlimited lifetime for a leaked token (access logs, cached pages, shared HARs) plus the absence of any revocation short of rotating `MOCHI_KEY`, which mochiConfig.ts also notes invalidates every image URL. That is a textbook missing-expiry finding on a bearer capability, and sealing `iat` with a configurable window is the proportionate fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
