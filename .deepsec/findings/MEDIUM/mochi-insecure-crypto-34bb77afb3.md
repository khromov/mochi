# [MEDIUM] Deflate-before-encrypt creates a CRIME/BREACH-style compression oracle in the general-purpose sealing primitive

**File:** [`packages/mochi/src/islands/payloadCrypto.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/islands/payloadCrypto.ts#L49-L70) (lines 49, 64, 65, 66, 67, 68, 69, 70)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `insecure-crypto`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`encryptPayloadBytes` deflates the plaintext before AES-SIV encryption, and `compress` defaults to true (L49, L65-70). Because AES-SIV is deterministic (same key + same AAD + same plaintext => byte-identical token), the emitted token length is a direct function of the plaintext's compressibility. Any payload that mixes a secret with attacker-influenced data therefore leaks the secret one guess at a time: the attacker varies the controlled portion and watches the token shrink when their guess matches a byte sequence already present in the secret. This is exactly the CRIME/BREACH pattern that caused TLS-level and HTTP-level compression of secret-bearing data to be abandoned.

The primitive is not internal-only. `index.ts:156` exports `encryptPayload`/`decryptPayload`, and `packages/docs/140-utility-helpers.md:79-85` advertises it for "short-lived signed values such as form challenges or magic links" — i.e. the payload is expected to be a secret. Internally it also seals server-island props (`serverIslandCrypto.ts:31`, `compress: options.compressServerIslandProps ?? true`), where the props bag routinely mixes request-derived values with server-side data in one compression context, and the resulting deterministic token is published in the page HTML.

The determinism alone also yields an equality oracle: two renders with identical props produce identical tokens, so an observer can tell that two users' island props are the same without decrypting. That trade-off is documented in the header comment (L11-12); the compression interaction is not.

## Recommendation

Default `compress` to false and require callers to opt in per call site (keeping it on only for the packed image-request payload, which contains no secret). Where compression is kept for size reasons, document that the payload must not mix secret and attacker-controlled data, and consider padding the plaintext to a bucket boundary before deflate so token length no longer tracks compressibility.

## Revalidation

**Verdict:** true-positive

The code is as described: `encryptPayloadBytes` deflates before sealing, `compress` defaults to `true` for payloads ≥ 80 bytes (payloadCrypto.ts:65-70), and AES-SIV in CTR mode adds no padding, so the base64url token length is an exact function of the deflated plaintext length — a byte-granular compressibility oracle. Determinism compounds it: `aessiv(key, aad)` with no nonce means identical plaintexts always yield identical tokens, so there is no per-render length jitter to hide behind. The primitive is public (`index.ts:156`) and `packages/docs/140-utility-helpers.md:79` recommends it for 'short-lived signed values such as form challenges or magic links', i.e. payloads a caller is told to treat as secrets, with no warning that mixing a secret with attacker-influenced data in one compression context is unsafe. Internally the exposed instance is server-island props: `encryptProps` passes `compress: options.compressServerIslandProps ?? true` (serverIslandCrypto.ts:31) and the resulting token is published in the page HTML as `signed-props`, while props bags naturally mix request-derived values (the docs' own `<Visitor mochi:defer name={visitorName}>`, live in `packages/site/src/demos/your-first-mochi-app/Hello.svelte:17`) with server-side data. That is precisely the BREACH setup, and the classic attack applies: drive the victim's browser to render pages with adaptive guesses in the controlled prop and read response length off the wire. I checked the other call sites and none are vulnerable on their own — the image payload is src+transform params with no secret (imageCrypto.ts:15), and captcha/clearance plaintexts are entirely server-generated — so reachability depends on an app's prop composition rather than on framework-internal data. I keep MEDIUM: the weakness class is real and acknowledged industry-wide, the fix (default `compress: false`, opt in per call site, or pad to buckets) is cheap, but practical exploitation needs a length observer and a secret/attacker-data mixed payload, so this is a defaults-and-documentation defect rather than a live hole in the shipped sites.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
