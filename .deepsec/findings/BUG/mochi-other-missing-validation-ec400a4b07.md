# [BUG] Security-relevant numeric image options are accepted unvalidated while every neighbouring field throws on bad input

**File:** [`packages/mochi/src/image/config.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/config.ts#L63-L104) (lines 63, 78, 101, 102, 103, 104)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-missing-validation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`resolveSize` is deliberate about validation: `checkDimension` rejects non-finite or sub-1 `width`/`height` (L10-18), `quality` is finite-checked and clamped to 1..100 (L42-46), `rotate` is finite-checked (L47-49), and an out-of-set `format` throws (L39-41). But the options that bound resource use and decompression are passed straight through with no check at all:

- L63: `maxPixels: p.maxPixels ?? defaults.maxPixels` — this is the decompression-bomb guard handed to `new Bun.Image(input, { maxPixels })` in `resize.ts:52`. `maxPixels: 0`, `-1`, `NaN`, `Infinity`, or a string arriving from `process.env` reaches `Bun.Image` unchecked and can silently disable the guard for every transform using that size (and, via L78, globally).
- L101: `fetchTimeoutMs` feeds `AbortSignal.timeout(opts.fetchTimeoutMs)` in `fetchSource.ts:71`. A `0` or negative value aborts every source fetch instantly, silently 502-ing all images.
- L102: `maxResponseBytes` feeds the body cap; `0`/negative/`NaN` either rejects everything or disables the cap.
- L103-104: `timeToStale`/`timeToEvict` are unchecked and unordered, so `timeToStale > timeToEvict` yields a browser `max-age` longer than the server retains the entry at all (`imageEndpoint.imageCacheControl` clamps SWR to 0 but leaves `max-age` at the larger value).

Unlike a bad `width`, none of these fail loudly at startup — the misconfiguration surfaces only as an outage or a quietly weakened limit at request time.

## Recommendation

Extend the existing startup validation to cover these fields: require `maxPixels`, `maxResponseBytes` and `fetchTimeoutMs` to be finite positive numbers (throwing the same style of error as `checkDimension`), require `timeToStale <= timeToEvict`, and clamp `maxPixels` to a sane ceiling so a typo cannot disable the decompression-bomb guard. Validating in `resolveImageOptions`/`resolveSize` keeps the failure at boot where it is visible, consistent with how `format`/`quality`/`rotate` already behave.

## Revalidation

**Verdict:** true-positive

Verified by exhaustive grep: `maxPixels`, `fetchTimeoutMs`, `maxResponseBytes`, `timeToStale` and `timeToEvict` are validated nowhere in the framework. `config.ts` throws only four errors (lines 15, 40, 44, 48 — dimensions, format-in-outputFormats, quality finiteness, rotate finiteness), and the five fields named in the finding are passed through verbatim at L63/78/101/102/103/104. The consumers are as claimed: `resize.ts:52` does `new Image(input, { maxPixels: size.maxPixels, autoOrient })` and `resize.ts:144` the same for placeholders; `fetchSource.ts:71` does `AbortSignal.timeout(opts.fetchTimeoutMs)`; `fetchSource.ts:117/121` use `maxResponseBytes` for both the Content-Length pre-check and the streaming cap; `config.ts:129-130` feeds timeToStale/timeToEvict into `ImageCache` as minTimeToStale/maxTimeToLive and `imageEndpoint.ts:37-41` into Cache-Control. The ordering claim is right too: `imageCacheControl` computes `swr = Math.max(0, floor((evict - stale)/1000))`, so `timeToStale > timeToEvict` clamps SWR to 0 but still advertises the larger `max-age`, i.e. a browser caches longer than the server retains the entry. The `maxPixels` weakening is the one claim that rests partly on Bun's internals: Bun's docs describe it as 'Reject if width*height > this', and `w*h > NaN` is false, so a NaN (e.g. `Number(process.env.MAX_PIXELS)` on an unset var) plausibly disables the decompression-bomb guard — I could not verify Bun's own coercion/validation statically, but the missing validation on Mochi's side is unambiguous regardless. `AbortSignal.timeout` likewise turns NaN into 0 (instant abort → every source fetch 502s) and a negative into a thrown RangeError/TypeError that escapes `ImageError` handling and surfaces as a generic 500. So this is a genuine, internally inconsistent missing-validation gap — correctly rated BUG, since it needs operator misconfiguration and is not independently exploitable.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
