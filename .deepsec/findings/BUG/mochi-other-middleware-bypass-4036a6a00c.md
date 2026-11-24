# [BUG] `handle` middleware, `transformPage`, and `filterResponseHeaders` never run for the interstitial, so app security headers are silently absent from it

**File:** [`packages/mochi/src/protection/gate.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/protection/gate.ts#L119-L155) (lines 119, 155)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-middleware-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The interstitial `Response` is constructed with only `Content-Type` and `Cache-Control` (L119-122) and returned through `finalizeCookieHeaders` (L155). Because the gate executes inside `buildRequestContext`, that response leaves as an `earlyResponse` (`runtime/requestSetup.ts:132-135`) and the page handler returns it immediately at `Mochi.ts:971-973` — before `options.handle` is ever invoked (`Mochi.ts:991`). The app's middleware chain, and with it `resolve()`'s `transformPage` and `filterResponseHeaders`, is therefore completely skipped for every protection-blocked request.

That matters more here than for the other early exits (trailing-slash 308s, CSRF 403s) because the interstitial is not an inert error body: it is a full HTML document that loads and executes JavaScript (the `MochiCaptchaAuto` island running the hash chain and PoW), and it is the one page served to *every* unverified visitor — including the first request of every legitimate first-time user.

Mochi ships no security headers of its own (I grepped: no `Content-Security-Policy`, `X-Frame-Options`, or `Strict-Transport-Security` anywhere in `packages/mochi/src`), and middleware is the only documented place to add response headers (`packages/docs/120-middleware.md:103-115`). This repo's own `packages/support/src/embedHeaders.ts` is exactly that pattern, mounted via `handle: sequence(adminAuth, embedHeaders, …)` in `support/src/index.ts:41`. An app following that pattern and enabling `protection` would serve its JS-executing interstitial with no CSP and no framing protection, while every other page on the site is covered. Neither `packages/docs/152-protection.md` nor `protectionServe.test.ts` mentions or covers this interaction.

I found no injection point in the interstitial itself (all five props are server-generated and Svelte-escaped), so this is a silent loss of defense-in-depth rather than a directly exploitable flaw — hence BUG rather than a security severity.

## Recommendation

Either run the protection gate through the middleware chain (so blocked responses pass `transformPage`/`filterResponseHeaders` like any other), or give `interstitialResponse` an explicit header hook so the resolved options can attach the app's security headers. At minimum, document in `152-protection.md` that middleware does not run for blocked requests and that the interstitial needs its headers configured separately; adding `X-Content-Type-Options: nosniff` to it (as the framework already does for JS/CSS assets at `Mochi.ts:1885`) would be a cheap improvement.

## Revalidation

**Verdict:** true-positive

Confirmed for the dominant case. The interstitial is built with only `Content-Type` and `Cache-Control: no-store` (gate.ts:119-122) and returned through `finalizeCookieHeaders` (L155); because the gate lives in `buildRequestContext` (requestSetup.ts:130-136) that response exits as `earlyResponse` and the page handler returns it at Mochi.ts:971-973, several lines before `middleware` runs at L991. I traced `transformPage`/`filterResponseHeaders` to `applyResolveOptions` in `runtime/hooks.ts:162-190`, driven only by a `resolve(event, opts)` call from inside a `Handle` — so both are middleware-scoped and both are skipped along with the chain. I independently verified the premise that makes this matter: a case-insensitive grep across all of `packages/mochi/src` for `content-security-policy`, `x-frame-options`, and `strict-transport-security` returns nothing, and `packages/docs/120-middleware.md:98-115` documents `resolve(event, opts)`/middleware as the place to shape response headers. This repo's own `packages/support/src/embedHeaders.ts` is exactly that pattern — a `Handle` that awaits `resolve(event)` then rebuilds the Response to `set('Content-Security-Policy', ...)`, with an in-file comment noting `filterResponseHeaders` 'can only drop headers, never add one' — mounted at `support/src/index.ts:41` via `sequence(adminAuth, embedHeaders, analytics(...))`. An app on that pattern that enables `protection` would ship its one JS-executing, every-first-time-visitor page with no CSP while every other page is covered. Two refinements, neither fatal: (a) for `fallback` kind the gate runs *inside* `composedFetch`'s middleware chain (Mochi.ts:1898-1903, wrapped by L1922) and the blocked response goes through `applyResolveOptions`, so fallback interstitials *do* get middleware — the finding's unqualified 'never' is too strong, though page routes are the primary and intended protection target; (b) error pages are unaffected because `routeErrorResponse` is invoked inside `inner`, making the interstitial genuinely anomalous among the framework's HTML responses. The finding's own scoping is honest and matches my reading: all five interstitial props are server-generated and Svelte-escaped, so this is lost defense-in-depth with no injection vector. BUG is the right severity; the claim is accurate.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
