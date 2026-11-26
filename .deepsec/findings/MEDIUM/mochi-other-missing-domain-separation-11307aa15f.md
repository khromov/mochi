# [MEDIUM] Image token AAD lacks a purpose label, so tokens minted for other payload types are accepted and their plaintext drives an outbound fetch

**File:** [`packages/mochi/src/image/imageCrypto.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/imageCrypto.ts#L15-L19) (lines 15, 19)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-missing-domain-separation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`encryptImageRequest`/`decryptImageRequest` bind only the bare `filename` as AAD. `islands/payloadCrypto.ts` derives ONE key (`HMAC-SHA512(secretKey, 'mochi-payload-aes-siv-v1')`) for every payload type in the framework — image requests, server-island props (`aad: componentName`), captcha tokens (`aad: 'mochi-captcha'`), protection clearance (`aad: 'mochi-protection'`), and anything an app seals with the publicly exported `encryptPayload()`. Nothing in the sealed plaintext identifies its purpose, so the AAD string is the only domain separator.

The image endpoint derives that AAD entirely from attacker input: `imageEndpoint.ts:74` does `const filename = url.pathname.split('/').pop() ?? ''` and passes it to `decryptImageRequest(token, filename)` at L82. The client therefore chooses both halves of the (AAD, ciphertext) pair and can replay any token sealed elsewhere whose AAD it can reproduce as a single path segment.

Concrete reachable instance: `compiler/svelteAstPreprocess.ts:300` emits every server island into the page as `<mochi-server-island component-name="Foo" signed-props="<token>" …>`. Both the ciphertext and its AAD are plainly visible in the HTML. `GET /_mochi/image/Foo?p=<signed-props token>` makes `decryptPayloadBytes` succeed (same key, matching AAD), and the devalue props JSON is then reinterpreted by `unpackImageRequest` as a packed image request: byte 0 of `[`/`{` sets the ORIGINAL and HTTP_PREFIX control bits, byte 1 is read as a varint size-name length, and everything past that offset becomes `src = 'http://' + <tail of the props plaintext>`, which `fetchImageSource` then fetches.

Two consequences. (1) It is a cross-AAD confirmation oracle — 403 means the AAD/key did not match, 400/502 means the token decrypted fine. (2) Where the sealed props contain an attacker-influenced string that lands at the computed offset (a search term, a username, a URL — common in `mochi:defer` props), the attacker can steer the host portion to a server they control and the server will fetch `http://attacker.tld/<remainder of the sealed plaintext>`, exfiltrating props the framework encrypts precisely because they may be secret (`packages/docs/148-images.md:92` recommends a server island as the way to keep a `src` secret). Either way it contradicts the documented guarantee in `148-images.md:17` that "an attacker cannot request arbitrary sources or transforms".

Related hardening gap in the same chain: `payloadCrypto.aadComponents()` treats `aad: ''` as falsy and silently degrades to no AAD at all. The image mint never produces an empty filename (`slugifyStem` falls back to `'image'`), so it is not exploitable here, but any path that can reach an empty AAD loses binding entirely rather than failing closed.

## Recommendation

Prefix a constant purpose label into the AAD on both sides of this file, e.g. `aad: `mochi-image-v1:${filename}``, so an image token can never collide with a captcha/clearance/island/app-sealed token regardless of what path segment the client sends. Better still, derive a per-purpose key in `payloadCrypto` (add a `purpose` argument folded into the HMAC label) so domain separation does not depend on a request-controlled string at all. Separately, make `aadComponents` reject/throw on an empty-but-present `aad` instead of silently dropping it, and have `imageEndpoint.ts` 403 immediately when the path segment is empty.

## Revalidation

**Verdict:** true-positive

This is the same vulnerability as F1, described from the crypto half of the chain (missing purpose label in the AAD) rather than the codec half (missing type tag). Because the duplicate verdict is only valid within a single file and these are two different files (`imageCrypto.ts` vs `imageCodec.ts`), it gets its own real verdict — and everything it asserts is independently verified. `encryptImageRequest`/`decryptImageRequest` bind only the bare `filename` (L15/L19); `payloadCrypto.sivKey()` derives one 64-byte key from `HMAC-SHA512(secretKey, 'mochi-payload-aes-siv-v1')` shared by image requests, island props (`aad: componentName`), captcha (`aad: 'mochi-captcha'`), clearance (`aad: 'mochi-protection'`) and anything an app seals with the exported `encryptPayload()`; the sealed plaintext is only `flags(1) || payload`, carrying no purpose discriminator; and the endpoint lets the client choose the AAD outright (`imageEndpoint.ts:74` → L82). The concrete instance is the one I confirmed for F1: `component-name` and `signed-props` are both printed in the page HTML by `svelteAstPreprocess.ts`, `islandIdentity()` keeps the island key a bare `\w+` token and therefore a legal path segment, and the devalue plaintext reinterprets as `original: true` + a 123-byte garbage size + `src = 'http://' + plaintext.slice(125)`. Both consequences are real: the 400-vs-403 split is a cross-purpose confirmation oracle (verified to work for captcha tokens, whose ~78-byte plaintext clears the offset; it does NOT work for clearance tokens, whose ~31-byte plaintext makes `unpackImageRequest` return null and the response identical to a decrypt failure), and where a controllable string prop lands at the computed offset the server fetches an attacker-chosen host and reflects the body, exfiltrating the rest of the sealed props into the attacker's access log — contradicting both `148-images.md:17` and the Callout at ~line 92 that names `mochi:defer` as the way to keep a `src` secret. The `aadComponents` note is also accurate (`return aad ? [...] : []` silently drops an empty-but-present AAD) and correctly flagged as a hardening gap rather than an exploit, since `slugifyStem` falls back to `'image'` so the minter never produces an empty filename. I am leaving the severity at MEDIUM deliberately: the HIGH already sits on F1 for the same chain, and raising this too would double-count one defect. Both halves of the recommended fix (a purpose-prefixed AAD, or better a per-purpose HMAC label in `sivKey()`, plus a filename-shape check before the AAD is used) are needed.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
