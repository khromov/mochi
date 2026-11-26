# [MEDIUM] MOCHI_KEY fails open: a non-base64url value decodes to 0 bytes, making every sealed token forgeable

**File:** [`packages/mochi/src/mochiConfig.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/mochiConfig.ts#L31-L49) (lines 31, 32, 33, 42, 43, 49)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `insecure-crypto`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`initMochiConfig()` accepts whatever `MOCHI_KEY` decodes to and only logs a warning. `Buffer.from(envKey, 'base64url')` is lenient — it silently drops characters outside the base64url alphabet — so any value with fewer than two valid characters decodes to an EMPTY buffer. Verified decode lengths: `" "` -> 0 bytes, `"x"` -> 0 bytes, `"="` -> 0 bytes, `"@@@"` -> 0 bytes, `"changeme"` -> 6 bytes, `"hunter2"` -> 5 bytes. Because `envKeyPresent = Boolean(envKey)` is true (no trim, no validation), the random-key fallback on L42 is skipped, and the key flows to `payloadCrypto.sivKey()`, which derives the AES-256-SIV key as `createHmac('sha512', secret).update('mochi-payload-aes-siv-v1')`. With a 0-byte secret that derivation is a constant any attacker can compute offline, and with a passphrase-shaped value (5-6 bytes) it is trivially brute-forced. Per the repo's own design, that single key is the entire authorization boundary for: server-island props (`serverIslandCrypto.ts:31`), signed image URLs (`imageCrypto.ts:15` — forging these turns the image endpoint into an SSRF primitive, and `packages/site` sets `image.blockPrivateNetworks: false`), captcha tokens (`captcha.ts:50`), protection clearance cookies (`clearance.ts:13`), and any app token built on the public `encryptPayload` export. The framework already DETECTS this exact condition on L43 (`baseKey.length < 32`, message: "this is likely a typo or truncated value") and proceeds anyway, including in production. This is distinct from the documented dev ergonomic of generating a random key when `MOCHI_KEY` is unset — that path is unforgeable; this one hands an attacker the key. A stray quote, trailing space, or placeholder in a deploy secret is the realistic trigger.

## Recommendation

Validate the key instead of warning: trim `envKey`, reject it if it does not match `/^[A-Za-z0-9_-]+$/`, and throw (rather than warn) when `baseKey.length < 32` and `development === false`. At minimum hard-fail on a 0-byte decode in every mode, since no legitimate configuration produces it. Consider `crypto.hkdf`-style expansion with an explicit minimum-entropy check so a short key can never silently become a working key.

## Revalidation

**Verdict:** true-positive

The code path is exactly as reported. mochiConfig.ts:32 computes `envKeyPresent = Boolean(envKey)` with no trim or format validation, so any non-empty string suppresses the `randomBytes(32)` fallback at line 42; `Buffer.from(envKey, 'base64url')` then decodes leniently, silently dropping out-of-alphabet characters, so a value with fewer than two valid base64url characters yields a zero-length buffer, and passphrase-shaped values yield 5-6 bytes (the finding's figures for 'changeme'→6 and 'hunter2'→5 match Node's base64 decoding semantics exactly). Lines 43-49 *detect* the condition (`baseKey.length < 32`, 'likely a typo or truncated value') and then proceed anyway in every mode. The key flows to `payloadCrypto.sivKey()` (line 41), which derives the AES-256-SIV key as `createHmac('sha512', secret).update('mochi-payload-aes-siv-v1')` — with a short secret that is offline-brute-forceable, and since AES-SIV decryption verifies its own tag an attacker with one observed token has a cheap offline verifier. That single key is the whole authorization boundary for server-island props, signed image URLs, captcha tokens, protection clearance cookies, and the public `encryptPayload` export. I confirmed no compensating validation exists anywhere: no `checkEnvironment` check, no app-level `mochi:init` assertion (packages/support enforces ADMIN_PASSWORD/SMTP_HOST/MOCHI_ORIGIN only), and docs/70-server-islands.md:234 plus the payloadCrypto header comment actively advertise that 'any MOCHI_KEY length works'. This is correctly scoped away from the known false-positive (random key when unset is unforgeable; this path is not). One caveat I could not settle statically without running code: for the exact zero-byte case the forgery claim additionally assumes `createHmac` accepts a zero-length key — overwhelmingly likely (RFC 2104 permits any key length and OpenSSL/BoringSSL allow it), but if it threw, the outcome would be a noisy fail-closed error rather than a forgeable key. The short-key case needs no such assumption, so the finding stands at MEDIUM either way.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-25)
