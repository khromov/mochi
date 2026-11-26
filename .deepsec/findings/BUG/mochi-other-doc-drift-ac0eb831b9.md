# [BUG] `defaultsSample` omits three of the component's CSS custom properties, on the page that documents them

**File:** [`packages/site/src/demos/captcha-styling/themes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/captcha-styling/themes.ts#L53-L64) (lines 53, 64)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-doc-drift`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`defaultsSample` is a hand-maintained copy of the `var()` fallbacks in `MochiCaptcha.svelte`, and its comment claims completeness: "Each var's built-in fallback." It is rendered on the page as the authoritative "Defaults" sample. It lists 9 custom properties but the component defines 12 — the three error-state vars are missing: `--mochi-captcha-error-bg` (fallback `#fdf3f2`, MochiCaptcha.svelte:468), `--mochi-captcha-error-border` (`#e9c9c4`, line 469) and `--mochi-captcha-error-text` (`#8a3324`, line 487).

This is exactly the failure mode the file's own header comment sets out to prevent ("what the page shows can't drift from what it does"). That guarantee holds for the three themes, which feed the live widgets and the code samples from one source, but `defaultsSample` is a duplicated literal with nothing tying it to the component, and it has already drifted. A reader theming the captcha from this page will style the widget's normal state and leave its error state unstyled, so a themed captcha reverts to the stock off-white/red error box on failure — and on the `terminal` theme, which squares off `--mochi-captcha-radius`, the mismatch is visible.

No security impact: the values are static, non-secret, and all nine listed entries match the component exactly.

## Recommendation

Add the three `--mochi-captcha-error-*` vars to `defaultsSample` with their current fallbacks, or narrow the comment to say the sample covers the non-error vars only. Better, add a test that asserts every `var(--mochi-captcha-…, <fallback>)` in `MochiCaptcha.svelte` appears in `defaultsSample` with a matching value, so the next var added to the component cannot silently drift out of the documentation.

## Revalidation

**Verdict:** true-positive

Verified by direct enumeration. `grep -n 'var(--mochi-captcha' packages/mochi/src/captcha/MochiCaptcha.svelte` yields 15 usages across exactly 12 distinct custom properties. `defaultsSample` (themes.ts:53-64) lists 9, and all 9 match the component's fallbacks precisely: `hint-text` #6e756d (L392/448), `border` #e8e4d8 (L398), `radius` 999px (L399/408/419), `track-bg` #faf8f1 (L400), `accent-soft` #e0ebe1 (L407), `handle-bg` #fffdf8 (L420), `accent` #4a7c59 (L421), `handle-text` → `var(--mochi-captcha-accent, #4a7c59)` (L422), `accent-soft-text` #2f5b3f (L453). The three error-state vars are absent exactly as described: `--mochi-captcha-error-bg` (#fdf3f2, L468), `--mochi-captcha-error-border` (#e9c9c4, L469), `--mochi-captcha-error-text` (#8a3324, L487). So the sample's own comment, 'Each var's built-in fallback', is false, and this is precisely the drift the file header sets out to prevent ('what the page shows can't drift from what it does') — that guarantee holds for the three `themes` entries, which feed both the live widgets and the rendered samples from one object, but `defaultsSample` is an unlinked duplicated literal. The practical consequence the finding describes is real and I can see it in the codebase: the framework's own `ProtectionShell.svelte` dark-mode block overrides all three `--mochi-captcha-error-*` vars, demonstrating that a serious themer does need them, while a reader working from this page would theme only the normal state and leave the error box at the stock off-white/red — visibly mismatched under the `terminal` theme, which sets `--mochi-captcha-radius: 0`. No security impact: the values are static, non-secret presentation defaults. BUG is the correct severity; the finding's own 'Confidence: medium' understates it — the claim is fully verifiable.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-16)
