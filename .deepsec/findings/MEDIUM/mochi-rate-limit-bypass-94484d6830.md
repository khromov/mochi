# [MEDIUM] The protection gate short-circuits before the rate limiter, so unverified clients are never metered and never accumulate ban violations

**File:** [`packages/mochi/src/runtime/requestSetup.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/requestSetup.ts#L130-L136) (lines 130, 131, 132, 133, 134, 135, 136)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`buildRequestContext` runs the protection gate at L130-136 and returns `{ earlyResponse }` on a block. The rate limiter is a separate step that runs only *after* a context exists — `checkRouteLimit(routeLimiters.get(pattern), ctx, req)` at Mochi.ts:981 (page) and :1211 (api). Consequently every request from a client that has not solved the proof-of-work is answered without the limiter ever being consulted.

Two effects. First, per-route `rateLimit` with a configured `ban` (rateLimit.ts:234) can never fire against an abusive unverified client, because the violation counter is only incremented inside `limiter.check()`, which is skipped — the two defenses silently cancel each other, and the one operators would expect to catch a flood is the one that is bypassed. Second, each blocked navigation costs a full `registry.renderComponent()` plus `renderShell()` of the interstitial (protection/gate.ts:85-123, reached for every GET/HEAD page hit), so an attacker who simply ignores the interstitial gets an unmetered SSR render per request. (I checked the companion path: `verifyCaptcha` is only ~11 SHA-256 operations, so the verify endpoint itself is not an amplification vector — the cost is in the interstitial render.)

## Recommendation

Run the route limiter before the protection gate (or run it inside the gate's blocked path) so unverified traffic still spends quota and accumulates ban violations. At minimum, give the interstitial path its own cheap limiter keyed on `getClientAddress()`, and serve a static 403 body once a client exceeds it rather than re-rendering the component.

## Revalidation

**Verdict:** true-positive

The ordering claim is exactly right. `buildRequestContext` runs the protection gate at requestSetup.ts:130-136 and returns `{ earlyResponse }`, and both route handlers check `'earlyResponse' in setup` and return before anything else (Mochi.ts:971-973 for pages, :1202-1204 for api) — `checkRouteLimit` is only reached afterwards, at :981 and :1211 respectively. So a client without clearance is answered without `limiter.check()` ever running, which means hitlimit's counter and its violation/ban bookkeeping (rateLimit.ts:234, and `ban`/`recordViolation` in the store interface) never advance for exactly the traffic an operator configured them to stop: the two controls silently cancel. The cost side is confirmed too — gate.ts:129 routes every GET/HEAD page or fallback hit to `interstitialResponse`, which does a `mintCaptcha()` (AES-SIV seal + randomUUID, captcha.ts:43-52) plus a full `registry.renderComponent()` and `renderShell()` per request, against a limiter check that would have been a single store increment. I also verified the companion path the finding checked: the verify endpoint is registered straight into `bunRoutes` (Mochi.ts:1812-1813), so it isn't in `routeLimiters` and is unmetered as well, but `verifyCaptcha` is one decrypt plus a short hash check, so the amplification really does live in the interstitial render. 152-protection.md documents the gate as covering every route kind and positions it as a Cloudflare-style bot defence, with nothing said about metering, so this is a design gap rather than a stated trade-off. Requests are still 403'd, so nothing protected is reached — the impact is unmetered CPU plus an inert ban control, which keeps it at MEDIUM rather than higher.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
