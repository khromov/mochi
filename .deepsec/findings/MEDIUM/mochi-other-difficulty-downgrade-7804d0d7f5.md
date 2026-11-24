# [MEDIUM] verifyCaptcha has no default difficulty floor, so tokens are fungible across every captcha in the app

**File:** [`packages/mochi/src/captcha/captcha.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/captcha.ts#L50-L86) (lines 50, 66, 84, 85, 86)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-difficulty-downgrade`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The AAD is the module-level constant CAPTCHA_AAD = 'mochi-captcha' (pow.ts:5), used identically at mint (L50) and verify (L66). Every captcha token minted anywhere in an app therefore decrypts at every other captcha-protected endpoint. verifyCaptcha then honours whatever `bits` value was sealed into the token and never compares it against the verifying app's configured difficulty: the only guard is `options.minBits`, applied at L84-86 and ONLY when the caller passes it explicitly. The framework knows this — the JSDoc at L61 states 'without it, any endpoint minting easier tokens (a low-bits form captcha) devalues a harder one's proof', and Mochi.ts:1786 passes `minBits: protectionOptions.bits` for protection mode for exactly this reason. But `minBits` appears nowhere in packages/docs/ (grep over the whole docs package returns no match; the Options table in 150-captcha.md documents only bits/minAgeMs/maxAgeMs/store/storePath), so an app author has no way to learn it exists. Attack: an app mints 12-bit tokens on a low-value newsletter form and 22-bit tokens on a high-value contact form. An attacker harvests cheap 12-bit tokens from the newsletter page, solves them, and submits them to the contact form action, which calls verifyCaptcha(formData) with no minBits and accepts them — reducing the intended proof-of-work by a factor of 2^10. packages/site/src/routes.ts:261 shows how easy harvesting is in practice: '/api/captcha-demo/mint' is an unauthenticated JSON endpoint that returns a freshly minted token on demand.

## Recommendation

Default `minBits` to the verifying runtime's configured difficulty (`getCaptchaRuntime().options.bits`) instead of skipping the check when the option is absent, so a token minted below the app's own configured difficulty is refused by default. Additionally, add an optional `scope`/`aad` option that mixes a caller-supplied label into CAPTCHA_AAD so a token minted for one form cannot be redeemed at another, and document both `minBits` and the per-call `minAgeMs` in packages/docs/150-captcha.md.

## Revalidation

**Verdict:** true-positive

Verified mechanically. `CAPTCHA_AAD` is the module-level constant `'mochi-captcha'` (pow.ts:5), used identically at mint (captcha.ts:50) and verify (captcha.ts:66), so every captcha token in an app decrypts at every captcha-protected endpoint — there is no per-endpoint scope anywhere in the sealed payload (`{ iat, nonce, bits }`). verifyCaptcha then honours the sealed `bits` at L111 and the only floor is `options?.minBits !== undefined && bits < options.minBits` at L84-86, which is skipped entirely when the caller omits it. I confirmed the framework knows this matters: Mochi.ts:1786 passes `minBits: protectionOptions.bits` with a comment saying exactly why, and clearance.ts applies the same `bits < minBits` idea to clearance cookies. I grepped the whole repo for `minBits` — it appears only in Mochi.ts:1785-1786 and captcha.test.ts:357-367, and I read all of 150-captcha.md: the Options table lists only bits/minAgeMs/maxAgeMs/store/storePath and the API table shows `verifyCaptcha(formData, options?)` without enumerating options, so `minBits` is genuinely undiscoverable for an app author. The concrete attack holds: an app that mints cheap tokens on one form (`mintCaptcha({ bits: 12 })`, a pattern 152-protection.md:122 itself teaches) and expensive ones on another has its expensive form silently accept the cheap tokens, cutting the intended work by 2^(delta). packages/site/src/routes.ts:261 confirms harvesting is trivial — `/api/captcha-demo/mint` is an unauthenticated JSON endpoint returning a fresh token (rate-limited 60/min). The one thing I'd narrow: the exposure only exists in a mixed-difficulty app (a uniform-`bits` app is unaffected, since all tokens then cost the same), and no identity or authorization boundary is crossed — only proof-of-work cost. I'm keeping MEDIUM because this is precisely the constant-AAD / unscoped-capability-token pattern the project's own threat model asks reviewers to flag, and the fix (default `minBits` to the verifying runtime's `bits`) is a pure improvement.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
