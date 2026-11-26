# [BUG] MochiCaptchaOptions.bits is documented as defaulting to 16 while the real default is 19, and both widgets default the prop to 16

**File:** [`packages/mochi/src/captcha/types.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/types.ts#L9) (lines 9)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-stale-default`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The JSDoc at L9 reads 'Proof-of-work difficulty in leading zero bits. Default: 16.', but config.ts:27 defines DEFAULT_CAPTCHA_BITS = 19, which is also what packages/docs/150-captcha.md and the extensions docs state. The same stale 16 appears in packages/mochi/src/types.ts:705 ('Default: 16 bits, a 2s floor, ...'). Because this JSDoc is the hover text an application developer sees on the public MochiCaptchaOptions type, it misstates the shipped difficulty. The mismatch is not purely cosmetic: MochiCaptcha.svelte:12 and MochiCaptchaAuto.svelte:11 both default the `bits` prop to 16 as well, so rendering `<MochiCaptcha {token} />` without spreading the minted bits makes the widget solve for 16 leading zero bits while the server, reading 19 from the sealed token, requires 19. The widget finds a 16-bit nonce, reports itself verified, submits, and verifyCaptcha rejects it as bad-pow — which collapses into the generic 'Verification failed' message, giving the developer no clue why every submission fails.

## Recommendation

Correct the JSDoc here and in packages/mochi/src/types.ts:705 to 19, and have both widgets reference DEFAULT_CAPTCHA_BITS instead of a hard-coded 16 (or drop the prop default so a missing bits value fails loudly in validateProps rather than silently solving at the wrong difficulty).

## Revalidation

**Verdict:** true-positive

Verified against source and git history. types.ts:9 reads 'Proof-of-work difficulty in leading zero bits. Default: 16.' while config.ts:27 defines `DEFAULT_CAPTCHA_BITS = 19`; packages/mochi/src/types.ts:705 repeats the stale value ('Default: 16 bits, a 2s floor, a 15-minute expiry, and an in-memory nonce store'), and 150-captcha.md correctly states 19 in both its Options table (L163) and its Props table (L98). Git confirms the drift: `git log -S 'Default: 16.'` on captcha/types.ts points at e7335002, the original captcha commit, and `git show 5028c6b6^:…/config.ts` shows the pre-change code was `const bits = o.bits ?? 16;` — so commit 5028c6b6 raised the default to 19 and left the JSDoc and both widget prop defaults behind. MochiCaptcha.svelte:12 and MochiCaptchaAuto.svelte:11 are still `bits = 16`. The functional consequence the finding draws is sound: a developer writing `<MochiCaptcha token={captcha.token} />` instead of spreading `{...captcha}` gets a widget that brute-forces for 16 leading zeros, sets `verified = true`, submits, and is rejected at captcha.ts:111 roughly 7 times in 8 (a 16-bit solution has a 1/8 chance of also clearing 19), collapsing into the deliberately generic 'Verification failed' message with the real cause only on the `captcha:verify` event. I checked the framework's own call sites are unaffected — templates/ProtectionShell/ProtectionShell.svelte passes `{bits}` explicitly from the minted result. Note the mismatch fails closed, not open (the widget under-solves and is refused), so this is a documentation/consistency footgun rather than a security weakness; BUG and the finding's 'high' confidence are both right, and the recommendation to reference DEFAULT_CAPTCHA_BITS instead of a literal is the correct fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
