# [MEDIUM] Clearance token has no binding to the client that solved the proof-of-work, so one solve is infinitely shareable

**File:** [`packages/mochi/src/protection/clearance.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/protection/clearance.ts#L13-L39) (lines 13, 20, 39)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `auth-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`mintClearanceToken` seals only `{ iat, bits }` (L13), and `hasValidClearance` validates only the AES-SIV seal, the `iat` age window, and `bits >= minBits` (L20-39). Nothing binds the token to the requester: no client IP, no User-Agent hash, no single-use nonce, and no server-side record of issuance. The gate's sole check is `hasValidClearance(input.cookies.get(options.cookieName), options.maxAgeMs, options.bits)` (gate.ts:152).

Attack: an attacker solves the proof-of-work exactly once (at the default 19 bits, sub-second of CPU), POSTs the solution to `/_mochi/protection/verify`, and receives `_mochi_clearance=<token>`. That single cookie string can then be replayed verbatim by an unlimited number of distributed scrapers, from any IP, with any User-Agent, for the full `maxAgeMs` (4 hours by default). The per-visitor CPU cost that is the entire purpose of the gate is amortized to effectively zero. Because nothing is stored server-side, there is also no way to revoke a clearance or to detect that one token is being presented from thousands of addresses.

The docs (`packages/docs/152-protection.md`) market this as "Cloudflare-style browser verification" — but Cloudflare's `cf_clearance`, Anubis, and go-away all bind clearance to at least the User-Agent and usually a hashed client IP, specifically to prevent this amortization. Transferability is never disclosed; the docs' own testing snippet (L118-119) in fact demonstrates lifting the `Set-Cookie` value and replaying it on arbitrary later requests, and `protectionServe.test.ts:119-122` does the same across requests. The only acknowledgement of the risk is the comment at `config.ts:3` ("a leaked clearance goes stale the same afternoon"), which treats leakage as a passive-disclosure concern rather than as deliberate sharing.

This is a design-level weakness rather than an implementation slip, but it materially defeats the control it implements.

## Recommendation

Seal a client fingerprint into the clearance payload and re-derive it on validation: at minimum `uaHash` (SHA-256 of the `User-Agent`), and ideally a hash of `getClientAddress()` (optionally truncated to a /24 or /56 to tolerate mobile NAT and IPv6 rotation). Pass the request/context into `hasValidClearance` so it can compare. Expose the strictness as an option (e.g. `bindTo: 'none' | 'ua' | 'ua+ip'`) so operators behind carrier-grade NAT can relax it, and document the default. Adding a random `jti` to the payload would additionally allow optional server-side revocation.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. `mintClearanceToken(bits)` seals exactly `JSON.stringify({ iat: Date.now(), bits })` under `PROTECTION_AAD` (clearance.ts:13) — no IP, no UA, no `jti`, no server-side issuance record. `hasValidClearance(cookieValue, maxAgeMs, minBits)` takes no request or context argument at all (clearance.ts:20), so binding is architecturally impossible, not merely omitted; it checks only the AES-SIV seal, `typeof iat === 'number'`, `bits >= minBits`, and `-30_000 <= ageMs < maxAgeMs`. The gate's only check is `hasValidClearance(input.cookies.get(options.cookieName), options.maxAgeMs, options.bits)` (gate.ts:152). I read every file in `packages/mochi/src/protection/` (clearance, config, gate, types) plus `protection.test.ts` and found no fingerprinting anywhere: the test suite covers seal tampering, expiry, clock skew, bits floor, and AAD cross-spending (a captcha token is refused as a clearance) — and nothing about the requester, confirming this is the intended design. The cookie attributes (`httpOnly`, `sameSite: 'lax'`, `secure`) at Mochi.ts:1789-1795 stop XSS theft and some CSRF but are irrelevant to voluntary sharing; the attacker is the solver, who reads `Set-Cookie` off their own verify response — exactly what `protectionServe.test.ts` does (it lifts the clearance cookie via `clearanceCookieFrom(verified.setCookie!)` and replays it on later `fetch` calls, including against `publicDir` files). Concrete attack: solve once at 19-20 bits (~1s of CPU), POST to `/_mochi/protection/verify`, extract the cookie, hand it to N distributed scrapers for the full 4-hour `maxAgeMs`. Protection mode's entire value is imposing per-client proof-of-work cost; unbounded transferability amortizes that to ~0, and with no server-side record there is no revocation and no way to notice one token arriving from thousands of addresses. The peer comparison is apt — Anubis derives its challenge from the client IP/UA/Accept-Language, and Cloudflare's `cf_clearance` binds similarly — while `152-protection.md` markets this as 'Cloudflare-style browser verification' and discloses only that the clearance is 'a sealed `{ iat }` token ... keyed off MOCHI_KEY'. Keeping MEDIUM: this is a real, concrete defeat of the control's cost model in every deployment that enables it. I note the finding's `auth-bypass` slug is a misnomer — protection mode is not authentication (anyone may solve and enter), so the impact is anti-abuse efficacy, not access control; and the marginal benefit of binding is bounded, since a motivated adversary can pay one sub-second solve per IP anyway. That bounds severity at MEDIUM but does not make the gap unreal.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
