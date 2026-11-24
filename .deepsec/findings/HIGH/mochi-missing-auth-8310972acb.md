# [HIGH] Server-island endpoint renders any island with no authorization and no `handle` middleware; prop-less islands need no sealed token

**File:** [`packages/mochi/src/Mochi.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/Mochi.ts#L1559-L991) (lines 1559, 1574, 1584, 1596, 1620, 991)
**Project:** mochi
**Severity:** HIGH  •  **Confidence:** high  •  **Slug:** `missing-auth`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`/_mochi/island/:componentName` is registered directly on `bunRoutes` (L1559). Its only gates are (a) the component name must exist in `registry.serverIslandPaths`, and (b) the optional `protection` PoW gate. Two gaps compound:

1. **No token is required when the island has no props.** L1574-1586: `const signedProps = url.searchParams.get('props') ?? ''` and `if (signedProps) {decrypt...} else { decodedProps = {} }`. The sealed-props token is the *only* capability check on this endpoint, and it is skipped entirely when absent. This is the mainstream path, not a dead branch: `web-components/ServerIsland.ts:144` only sets `props` when `signed-props` is present, and prop-less islands are idiomatic (`<HydrationProbe mochi:defer />`, `<ServerStamp mochi:defer />`, `<DeferWithHydrators mochi:defer>` in packages/site). So `GET /_mochi/island/<Name>` executes that island's server-side render for anyone who knows or guesses the component name (names are component names, and are visible in any page's `component-name="..."` attribute).

2. **`handle` middleware never runs for this route.** `middleware` is invoked at exactly three places in this file — L991 (page), L1240 (api), L1922 (assets/fallback) — and not in the island handler. `types.ts:528` documents `handle` as "wrapping every incoming request — authentication, logging, headers", and `docs/120-middleware.md` shows an auth handle that returns 401 for everything except `kind === 'asset'`. The `event.kind` table there lists only page/api/asset/fallback/error and documents only WS/SSE as middleware-exempt — the island endpoint is never mentioned. An app that places its authorization in `handle` therefore believes this endpoint is gated when it is not. Rate limiting is likewise absent (`checkRouteLimit` is never called here, and `resolveLimiter` only runs for page/api patterns), so the endpoint is also an unauthenticated SSR-amplification vector.

Attack scenario: an app gates `/admin/*` in `handle` middleware and the admin dashboard contains `<AdminStats mochi:defer />` (no props — it queries the DB itself). An unauthenticated attacker requests `GET /_mochi/island/AdminStats`; `buildRequestContext` applies no CSRF/auth for `kind: 'island'`, middleware is skipped, `locals` is empty, the component's server-side data fetch runs, and the rendered HTML (containing the admin data) is returned with 200. Secondarily, because middleware never populates `locals`, any island that reads `locals.user` to decide what to show sees `undefined` during these out-of-band renders.

Related weakness: sealed props tokens carry no `iat`/expiry (unlike captcha tokens and clearance cookies, which both seal `iat` and are age-checked), so a token observed once is replayable indefinitely while `MOCHI_KEY` is unchanged.

## Recommendation

Run the `handle` chain for the island endpoint (construct a `MochiEvent` with a new `kind: 'island'` and wrap the render in `middleware({ event, resolve })`, as the page/api handlers do), and document the kind. Independently, stop treating an absent token as 'no props': always require a sealed token, minting one even for empty props (seal `{}` plus the island id), so every island fetch carries a server-minted capability. Add the island endpoint to the global `rateLimit` surface, and consider sealing an `iat` into island props with an expiry check so tokens are not valid forever.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. `bunRoutes[`${assetPrefix}/island/:componentName`]` (Mochi.ts:1559) calls `buildRequestContext(req, server, { kind: 'island' })`, and `KIND_POLICY.island` in runtime/requestSetup.ts:67 is `{ timeout: false, trailingSlash: false, csrf: false, debugBar: false }`. `middleware` is invoked at exactly three sites in Mochi.ts — 991 (page), 1240 (api), 1922 (composedFetch/assets) — and nowhere in the island handler; `resolveLimiter`/`checkRouteLimit` likewise only run in the `isMochiPage`/`isMochiApi` branches, so the endpoint has no rate limit either. Only the `protection` PoW gate (cfg.protection, requestSetup.ts:130) and the `serverIslandPaths` membership check apply. Lines 1574-1586 confirm `if (signedProps) {decrypt} else {decodedProps = {}}` — an absent token is treated as 'no props', not as a missing capability, so `GET /_mochi/island/<key>` renders the island with `props={}`, empty `locals`, and no authz. The docs make this a genuine trap: types.ts:528 says `handle` wraps 'every incoming request — authentication, logging, headers'; docs/120-middleware.md's `event.kind` table lists only page/api/asset/fallback/error and documents only WS/SSE as middleware-exempt; and docs/70-server-islands.md:222 actively tells authors to 'fetch data inside the island' via `getRequestContext()` rather than through props — exactly the shape that leaks when the render runs unauthenticated. One correction to the finding: the claim that prop-less islands routinely hit this branch is wrong. svelteAstPreprocess.ts:295-318 always injects `islandId: __mochi_iid` into the envelope, so every emitted `<mochi-server-island>` carries a `signed-props` attribute ('Server islands always emit signed-props') — the empty-props branch is reachable only by a hand-crafted request. That does not weaken the vulnerability (the server still does not require the token), only the 'mainstream path' framing. Discoverability is a real but surmountable obstacle: the key is `<localName>_<base36 Bun.hash(project-relative path)>` (islandIdentity, line 492), an unkeyed deterministic hash the code comment confirms is stable across machines, so it is computable offline from a guessed source path and visible in the HTML of any page that uses the island. Keeping HIGH: conditional on app shape (authz in `handle` + a defer island that doesn't read `locals`), but a real confused-deputy with no framework-side mitigation and no documentation of the exemption.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
