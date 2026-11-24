# [BUG] mintCaptcha does not range-check a per-call bits value, and a sealed bits <= 0 makes the proof-of-work check a no-op

**File:** [`packages/mochi/src/captcha/captcha.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/captcha.ts#L45-L111) (lines 45, 47, 50, 111)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-fail-open-validation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

At L45 `const bits = options?.bits ?? resolved.bits;` takes the caller's value verbatim. Nullish coalescing preserves 0. The value is sealed into the token at L50 with no validation, and verifyCaptcha re-reads it at L76-79 checking only `typeof bits === 'number'`. The 1-32 integer bound in resolveCaptchaOptions (config.ts:33-35) applies only to the Mochi.serve({ captcha: { bits } }) path, never to a per-call mintCaptcha({ bits }). The asymmetry is stark and looks like an oversight: `solveBudgetMs`, the very next option in the same function, IS validated at L47-49, and captcha.test.ts has a test for it ('rejects a non-positive per-mint solve budget') but no equivalent test for bits. Consequence: mintCaptcha({ bits: 0 }) seals bits:0, and the verifier's check at L111 becomes `leadingZeroBits(digest) < 0`, which is always false — so the proof-of-work is accepted unconditionally. Because `pow` is read as `String(formData.get('captcha_pow') ?? '')` at L65, even an empty captcha_pow passes. The failure mode is inverted: MochiCaptcha.svelte:116 and MochiCaptchaAuto.svelte:108 both reject bits<1 in validateProps and degrade to a blank spacer in production, so legitimate users cannot submit at all while a bot posting a valid token plus an empty pow sails straight through. A fractional value such as bits: 0.5 is a partial fail-open (roughly half of random pow values pass). Note bits: NaN fails closed, since JSON.stringify turns NaN into null and the typeof check at L76 then rejects it.

## Recommendation

Apply the same `Number.isInteger(bits) && bits >= 1 && bits <= 32` check to the per-call option inside mintCaptcha, throwing the same message resolveCaptchaOptions uses. As defence in depth, also reject a sealed `bits` outside 1-32 in verifyCaptcha so an old or malformed token can never disable the work check, and add a test mirroring the existing per-mint solveBudgetMs case.

## Revalidation

**Verdict:** true-positive

The code path is exactly as described. captcha.ts:45 is `const bits = options?.bits ?? resolved.bits;` with no validation — nullish coalescing preserves `0` — and the value is sealed at L50 unchecked. The 1-32 integer bound in config.ts:33-35 guards only the `Mochi.serve({ captcha: { bits } })` path (and, per the comment at config.ts:31, the `captcha:bits` filter, which is applied *before* the bound deliberately); it never sees a per-call mint. verifyCaptcha re-reads the sealed value with only `typeof parsed.bits !== 'number'` (L76) and then evaluates `leadingZeroBits(digest) < bits` at L111, so with `bits: 0` the comparison is `>=0 < 0`, always false, and the proof-of-work check is unconditionally satisfied — including for `pow === ''`, since L65 coerces a missing field to the empty string and `powInput` happily hashes it. I confirmed the asymmetry the finding leans on: `solveBudgetMs`, resolved two lines later, IS validated at L47-49, and captcha.test.ts:150-153 has `test('rejects a non-positive per-mint solve budget')` with no bits counterpart. I also verified the inverted failure mode in the widgets: MochiCaptcha.svelte:116 and MochiCaptchaAuto.svelte:108 both reject `bits < 1` in `validateProps`, mark it non-retryable, and in production `suppressed` collapses the whole `{#if mounted && !suppressed}` block — including the two hidden inputs at L374-375 — to a blank spacer, so real visitors submit no token at all while a scripted post with a token and empty pow passes. The fractional case checks out too: `bits: 0.5` accepts any digest whose first byte is < 128, i.e. ~half of nonces. And `NaN` does fail closed, because `JSON.stringify` writes `null` and the `typeof` guard at L76 rejects it. I'm downgrading to BUG rather than MEDIUM because `bits` is set only by application code — an attacker has no influence over it (the token is AES-256-SIV sealed and unforgeable), so reaching the fail-open requires a developer bug, and that bug simultaneously blocks every legitimate submission, which makes it loud rather than silent. It remains a genuine missing-validation/fail-open gap worth closing in both mintCaptcha and verifyCaptcha.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
