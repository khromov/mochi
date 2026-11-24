# [HIGH] baseContentType() ignores comma-delimited Content-Type values, letting an upstream bypass the inline-safe allowlist and render HTML/SVG at the app origin

**File:** [`packages/mochi/src/utils/inlineContentTypeSafety.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/utils/inlineContentTypeSafety.ts#L2-L12) (lines 2, 3, 12)
**Project:** mochi
**Severity:** HIGH  •  **Confidence:** medium  •  **Slug:** `xss`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`baseContentType()` derives the media type by splitting only on `;` (`contentType.split(';')[0].trim().toLowerCase()`). Browsers instead use the MIME Sniffing spec's "extract a MIME type" algorithm, which splits the Content-Type header value on COMMAS and keeps the LAST valid MIME type encountered.

An upstream that returns `Content-Type: image/png;x=1, text/html` therefore normalizes to `image/png` here, matches `INLINE_SAFE_IMAGE_TYPES` (L12), and `imageEndpoint.ts:26-29` `safeOriginalContentType()` returns `{ contentType, attachment: false }` -- echoing the RAW upstream string. `imageEndpoint.ts:103-114` then emits that verbatim with NO `Content-Disposition`. The browser resolves the header to `text/html` and renders the body as HTML in the application's own origin. `image/png;x=1, image/svg+xml` works identically for scriptable SVG.

`X-Content-Type-Options: nosniff` is not a mitigation: it prevents content-based sniffing, not honoring a declared `text/html`. I confirmed no framework-level CSP is applied to image responses (the only CSP in the repo is `packages/support/src/embedHeaders.ts`, a `frame-ancestors` directive on the newsletter embed).

The `original` path serves upstream bytes verbatim with no format validation (`inputFormats` is only consulted in `runPipeline`, on the variant path), and `imageCache.ts:288` stores the raw upstream content type into the sidecar unmodified, so the poisoned type persists across the cache.

This defeats an explicitly documented guarantee. `packages/docs/148-images.md` states: "A full-size original that is SVG (or any non-raster type) is served as a download rather than inline", in the same Callout that documents passing a user-controlled `src` into `getImageUrl()`/`getImage()` as a supported scenario. `safeOriginalContentType`'s own doc comment names the threat: "nosniff alone wouldn't stop a directly-navigated SVG from executing."

Attack chain: app calls `getImageUrl(userSuppliedUrl)` (default config allows any public host) -> attacker's server replies `Content-Type: image/png;x=1, text/html` with an HTML+script body -> the minted `/_mochi/image/<name>?p=<token>` URL is served inline -> any direct navigation to it (link, "open image in new tab", redirect) executes attacker script same-origin, with access to cookies and the CSRF-relevant Origin.

Existing tests (`imageEndpoint.test.ts:45-64`) cover `;` parameters and case folding but never a comma-delimited value, and L62 explicitly asserts the raw string is echoed back verbatim.

Second call site with the same defect: `dev/emailViewerRoutes.ts:89-94` computes `inlineSafe` from `baseContentType(att.contentType)` and then sets `Content-Disposition: inline` plus the raw `Content-Type`. Lower impact (dev-only via `emailViewerEnabled = development && transport === 'dev'`), but the same bypass applies to app-relayed user attachments.

## Recommendation

Make the normalization reject anything the browser could re-interpret, and never echo the upstream string: (1) In `baseContentType()`, treat a comma as a hard disqualifier -- e.g. return the raw input (guaranteeing an allowlist miss) if `contentType.includes(',')`, or split on `,` first and require every segment's essence to be inline-safe. (2) In `safeOriginalContentType()` (`imageEndpoint.ts:25-30`), return the normalized base type from the allowlist set rather than the caller-supplied `contentType`, so the response header can only ever be one of the five literal strings in `INLINE_SAFE_IMAGE_TYPES` (or `application/octet-stream`); this single change closes the bypass even if the normalizer is later loosened again. (3) Apply the same in `emailViewerRoutes.ts:91-98`: emit the normalized base type, not `att.contentType`. (4) Belt-and-braces: add `Content-Disposition: inline; filename="..."` on the inline branch too, so an inline decision is explicit rather than implied by the header's absence. (5) Add regression tests for `'image/png;x=1, text/html'`, `'image/png, text/html'`, and `'image/png;x=1, image/svg+xml'`.

## Revalidation

**Verdict:** true-positive

I traced the whole chain and every link holds. `baseContentType()` splits only on `;`, so `image/png;x=1, text/html` normalizes to `image/png` and hits `INLINE_SAFE_IMAGE_TYPES`; `safeOriginalContentType()` (imageEndpoint.ts:26-29) then returns `{ contentType: <raw upstream string>, attachment: false }`, and lines 103-114 emit that raw string verbatim with `X-Content-Type-Options: nosniff` and **no** `Content-Disposition`. The upstream value is never normalized upstream of that: `fetchImageSource` returns `res.headers.get('content-type')` raw (fetchSource.ts:122), `ImageCache.getOriginal` stores it unmodified (imageCache.ts:288) and `metaFrom` hands it back verbatim, so the poisoned type persists across the SWR disk cache and is re-served under a stable URL. I confirmed there is no byte/format validation on the `original` path — `inputFormats` is enforced only at resize.ts:67, on the variant path — and the image route is registered straight into `bunRoutes` (Mochi.ts:1707), so no `handle` middleware, `filterResponseHeaders`, or CSP ever touches it; the repo's only CSP is `packages/support/src/embedHeaders.ts` (`frame-ancestors`), exactly as the finding states. On the browser side I could not fetch the specs directly (egress denied), but search surfaced two independent confirmations of the parser differential: BlackFan's `content-type-research/XSS.md` catalogs comma-separated Content-Type values as a Chrome+Firefox XSS vector *with `nosniff` set*, and the 'Parse and Parse' research reports `application/json;,text/html` being parsed as `text/html` by Chromium-based browsers and Firefox — precisely the `<allowlisted>;<param>,text/html` shape here, and Chromium's net layer splitting Content-Type on commas is called out there too. Concrete attack: an app proxies an upstream whose Content-Type is attacker-influenced (a user-supplied `src`, which docs/148-images.md:262 explicitly blesses, or a user-uploaded S3/GCS object where the uploader sets the type); the upstream replies `Content-Type: image/png;x=1, text/html` with an HTML+script body; the minted `/_mochi/image/<name>?p=<token>` URL serves it inline at the app origin, and any top-level navigation to that URL (shared link, open-image-in-new-tab) executes attacker script same-origin with cookie access. `image/png;x=1, image/svg+xml` gives scriptable SVG identically. This defeats a named, documented guarantee ('A full-size original that is SVG (or any non-raster type) is served as a download rather than inline') and the control's own doc comment names the exact threat. Tests at imageEndpoint.test.ts:45-64 cover `;` params and case folding but never a comma, and :62 asserts the raw echo. The second call site (dev/emailViewerRoutes.ts:89-98) has the identical defect and additionally sets `Content-Disposition: inline`, though it is dev-only behind `emailViewerEnabled`. Nothing is fixed — the file is unchanged since #158. I keep HIGH: it requires a top-level navigation and a not-fully-trusted upstream, which is why it isn't CRITICAL, but it is a total bypass of a first-party security control in a published npm framework with same-origin script execution as the payoff.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
