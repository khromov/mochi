# [BUG] MOCHI_KEY is load-bearing for captcha tokens but unenforced, and .env.example says otherwise

**File:** [`packages/support/src/index.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/index.ts#L54-L66) (lines 54, 62, 66)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`mintCaptcha()` seals the challenge with `encryptPayload(..., { aad: CAPTCHA_AAD })` (captcha/captcha.ts:50), which keys off `getMochiConfig().secretKey` (islands/payloadCrypto.ts:39) — i.e. `MOCHI_KEY`, or a `randomBytes(32)` generated per boot with only a `logger.warn` when it is absent (mochiConfig.ts:33-42).

This app mints captchas on both of its public pages (routes.ts:36 and newsletter/routes.ts:23), yet the `mochi:init` hook (L62-79) enforces ADMIN_PASSWORD, SMTP_HOST and MOCHI_ORIGIN but not MOCHI_KEY, and .env.example:69-70 states the key is "only load-bearing if this site ever grows a mochi:defer island or signed image URLs" — which is wrong for this app.

Consequence with MOCHI_KEY unset: every restart or redeploy rotates the secret, so `decryptPayload` returns null for all in-flight tokens and `verifyCaptcha` rejects them as 'malformed'. Anyone holding the support form open — or holding a blog page whose iframed newsletter widget was rendered pre-deploy, which is every reader of mochi.fast — gets "Verification failed — reload the page and try again" on submit, with no way to tell it apart from a real failure. The same key rotation also means the app can never be run as more than one replica: a token minted by instance A is rejected by instance B.

## Recommendation

Add `MOCHI_KEY` to the `mochi:init` production boot checks alongside ADMIN_PASSWORD/SMTP_HOST/MOCHI_ORIGIN, and correct the .env.example comment to say the key signs captcha tokens for both public forms. While there, consider `CAPTCHA_NONCE_STORE=sqlite` for the deployed app — the default memory store (L57) also loses every burned nonce on restart, so solved tokens become replayable within their 15-minute window.

## Revalidation

**Verdict:** true-positive

Every link in this chain is verified. `mintCaptcha` seals the challenge with `encryptPayload(..., { aad: CAPTCHA_AAD })` (captcha/captcha.ts:51) and `verifyCaptcha` reopens it with `decryptPayload` (captcha.ts:66), returning `reject('malformed')` on `null`; `payloadCrypto.ts`'s `sivKey()` derives the AES-SIV key as `HMAC-SHA512(getMochiConfig().secretKey, …)`, and `initMochiConfig` (mochiConfig.ts:31-42) sets that secret from `MOCHI_KEY` or, when absent, from a per-boot `randomBytes(32)` behind nothing but a `logger.warn`. This app mints captchas on both of its public pages (routes.ts:36 and newsletter/routes.ts:23, each spread into `<MochiCaptcha>` via SupportForm.svelte:67), so the key is load-bearing here. Yet the `mochi:init` hook (index.ts:62-79) enforces only ADMIN_PASSWORD, SMTP_HOST and MOCHI_ORIGIN, and `.env.example` actively tells the operator the opposite — 'Silences a boot warning; only load-bearing if this site ever grows a mochi:defer island or signed image URLs' — with the variable left commented out, which makes 'unset in production' the likely state rather than a hypothetical. The consequence is as stated: every deploy or restart rotates the secret, so every captcha token already rendered into an open support page or an iframed newsletter widget decrypts to null and the visitor gets the deliberately-generic 'Verification failed — reload the page and try again', indistinguishable from a real failure; and a second replica could never verify the first's tokens. The replay note is also right that the default `store: 'memory'` (index.ts:57) drops burned nonces on restart, though with a rotating key those tokens are already unopenable, so the sqlite suggestion only matters once MOCHI_KEY is pinned. This is an availability/robustness defect plus wrong documentation, so the BUG severity is the right label.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
