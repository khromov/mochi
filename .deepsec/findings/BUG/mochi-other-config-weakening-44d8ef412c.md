# [BUG] An empty CAPTCHA_MIN_AGE_MS silently sets the captcha timing floor to 0

**File:** [`packages/support/src/index.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/index.ts#L55-L56) (lines 55, 56)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-config-weakening`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L56: `Number.isFinite(Number(process.env.CAPTCHA_MIN_AGE_MS)) ? Number(process.env.CAPTCHA_MIN_AGE_MS) : 2000`. `Number('')` is `0`, and `Number.isFinite(0)` is true, so `CAPTCHA_MIN_AGE_MS=` with no value — the exact shape this app's own .env.example uses for `SMTP_HOST=` (line 19) — resolves to `minAgeMs: 0` rather than falling back to 2000. `resolveCaptchaOptions` (captcha/config.ts:36-40) only validates `minAgeMs < maxAgeMs`, so 0 passes silently with no warning.

That removes the control the framework documents as load-bearing: "proof-of-work is a cost mechanism whose solve time is geometrically distributed with no lower bound, so a lucky solver clears the chain in milliseconds and this is the only thing enforcing that a submission took human time" (captcha/config.ts:8-11). With it at 0, a token can be minted, solved and submitted in one burst, which matters most on the support form — the route that has no rate limit at all (see the routes.ts finding).

This file's own sibling, `authFailureDelay()` in adminAuth.ts:31-34, explicitly guards against this identical trap (`const configured = raw ? Number(raw) : Number.NaN`, commented "An empty or malformed var must not silently disable the tarpit"). index.ts does not apply the same guard.

## Recommendation

Mirror adminAuth.ts's pattern: read `process.env.CAPTCHA_MIN_AGE_MS?.trim()` and treat an empty string as unset (`raw ? Number(raw) : Number.NaN`) before the `Number.isFinite` test. Consider also rejecting `minAgeMs: 0` in `resolveCaptchaOptions` unless explicitly opted into, since protection-mode auto-solve is the only legitimate zero case and it already passes `minAgeMs` per-call.

## Revalidation

**Verdict:** true-positive

The parsing bug is exactly as described and I confirmed every link. `Number('')` is `0` and `Number.isFinite(0)` is `true`, so `CAPTCHA_MIN_AGE_MS=` (or a whitespace-only value) resolves index.ts:56 to `minAgeMs: 0` instead of the intended 2000; `Number('abc')` is NaN and does fall back correctly, and the sibling `bits` on line 55 uses `||` so it is immune. `resolveCaptchaOptions` (captcha/config.ts:36-40) then takes it verbatim — `o.minAgeMs ?? DEFAULT` only replaces null/undefined, and the sole validation is `minAgeMs >= maxAgeMs`, which `0` passes — so there is no warning anywhere. `verifyCaptcha` (captcha/captcha.ts:95-102) applies the resolved value as the `ageMs < minAgeMs` floor, and config.ts:8-11 documents that floor as the only thing enforcing human-time submission since PoW solve time is geometrically distributed with no lower bound. The irony the finding points out is real: `authFailureDelay()` in adminAuth.ts:31-34 guards against this identical `Number('')` trap with an explicit comment, and index.ts does not copy it. I am downgrading severity because nothing in the committed configuration triggers it: `CAPTCHA_MIN_AGE_MS` is not mentioned in `.env.example` at all, so reaching `minAgeMs: 0` requires an operator to deliberately add the key with an empty value in the CapRover env. That makes it a latent config-parsing defect rather than a presently-weakened control — worth fixing (it compounds F7's missing rate limit on the same route), but not attacker-reachable as deployed.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
