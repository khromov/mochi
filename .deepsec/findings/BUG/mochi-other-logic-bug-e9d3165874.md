# [BUG] A negative ageMs is rejected as too-fast even when minAgeMs is 0, locking visitors out of protection mode under clock skew

**File:** [`packages/mochi/src/captcha/captcha.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/captcha.ts#L89-L102) (lines 89, 100, 101, 102)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

ageMs is computed at L89 as `Date.now() - iat`, where iat was sealed by whichever instance minted the token. The comment at L91-93 consciously declines to pad the floor, and 150-captcha.md documents that the drift allowance widens only the expiry bound. What neither accounts for is the minAgeMs === 0 case: the check at L100 is an unconditional `ageMs < minAgeMs`, so with minAgeMs 0 any negative age is refused even though a zero floor has no security value whatsoever to enforce. Mochi.ts:1786 verifies the protection interstitial with exactly `{ minAgeMs: 0, minBits: protectionOptions.bits }`. So in a multi-instance deploy where the minting instance's clock runs 5s ahead of the verifying one, a visitor who solves the auto-captcha in under 5s gets ageMs < 0, reject('too-fast'), and a 403. MochiCaptchaAuto.svelte then increments its sessionStorage attempt counter and offers a retry that reloads (L135-137); each reload may land on the same skewed instance pair, and after maxAttempts (default 5) the widget latches to phase 'exhausted' and the visitor is locked out of the entire site with no path forward. That the authors handled the mirror case elsewhere is strong evidence this is an oversight rather than a decision: clearance.ts:39 explicitly tolerates negative age with `ageMs >= -CLEARANCE_DRIFT_ALLOWANCE_MS`.

## Recommendation

Tolerate skew on the floor the way clearance.ts does, e.g. reject only when `ageMs < minAgeMs && ageMs >= -resolved.driftAllowanceMs` is violated, or simply skip the too-fast check when the effective minAgeMs is 0. At minimum, clamp so a negative ageMs can never fail a zero floor.

## Revalidation

**Verdict:** true-positive

Confirmed in code. `ageMs = Date.now() - iat` at L89 is never clamped, and the floor check at L100 is an unconditional `if (ageMs < minAgeMs) return reject('too-fast', …)`. With `minAgeMs === 0` any negative age is refused, and a zero floor enforces nothing, so the rejection buys no security — a negative age cannot indicate tampering, because `iat` is inside the AEAD-sealed payload and an attacker cannot move it. Mochi.ts:1786 is the framework's own and only `minAgeMs: 0` caller (`verifyCaptcha(formData, { minAgeMs: 0, minBits: protectionOptions.bits })`), so protection mode is exactly where this lands. I traced the client consequence: MochiCaptchaAuto.svelte `submit()` hits `!res.ok` on the 403, calls `failWith(detail)` with the default `retryable = true`, which increments the sessionStorage counter (L89-95) and latches `phase = 'exhausted'` at `maxAttempts` (default 5, resolveProtectionOptions), and `onMount` re-reads the counter at L125 so reloads stay exhausted. The authors' comment at L91-93 argues only against *padding* a positive floor (subtracting an allowance wider than minAgeMs would delete the check) — it does not address the case where there is no floor at all. The strongest evidence this is an oversight rather than a decision is the handled mirror case: clearance.ts:39 returns `ageMs >= -CLEARANCE_DRIFT_ALLOWANCE_MS && ageMs < maxAgeMs`, and protection.test.ts:87-90 has a dedicated test, 'a slightly-future clearance from a fast-clocked instance is accepted'. There is no equivalent test or tolerance for the captcha token. Two caveats keep this at BUG: it needs a multi-instance deploy without sticky routing (or a backward clock step) with skew exceeding the solve time — mint and verify landing on the same instance makes `ageMs` exact — and 150-captcha.md:185 shows the authors expect negative `ageMs` to occur in the field; also 'locked out with no path forward' is a little strong, since the counter is per-tab sessionStorage and a new tab clears it.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
