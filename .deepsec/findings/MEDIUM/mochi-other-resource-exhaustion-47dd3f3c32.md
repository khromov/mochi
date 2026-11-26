# [MEDIUM] No output-pixel budget: a single-dimension size amplifies an extreme-aspect-ratio source into an unbounded allocation

**File:** [`packages/mochi/src/image/resize.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/resize.ts#L47-L85) (lines 47, 52, 75, 76, 77, 85)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-resource-exhaustion`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`maxPixels` is passed only to the decoder (`new Image(input, { maxPixels: size.maxPixels })`, L52). Per Bun's docs it is 'Reject if width*height > this. Checked after reading the header, before allocating the pixel buffer' — it bounds the INPUT only. Nothing in the pipeline bounds the OUTPUT.

For a height-only size, L75-77 derives the width straight from the source's aspect ratio with no cap: `width = Math.max(1, Math.round(meta.width * (height / meta.height)))`. For a width-only size, L85 calls `pipe.resize(width, undefined, resizeOpts)`, which Bun documents as 'width 800, keep aspect ratio' — scaling the height by the same unbounded ratio. `withoutEnlargement` defaults to `false` (`config.ts:55`), so upscaling is allowed by default.

Concrete failure: a 1 × 100,000 px solid-colour PNG is a few hundred bytes and only 100k pixels, so it sails past the 50,000,000 default `maxPixels`. Under the canonical documented size `{ width: 1600 }` the target becomes 1600 × 160,000,000 px ≈ 2.6e11 pixels, ~1 TB at Bun's documented 4 bytes/pixel. One request OOM-kills the server process. Note that `maxPixels` is precisely the knob the docs point operators at for untrusted input (`types.ts:76,123`), so a hardened configuration still does not stop this.

Reachable wherever the framework transforms a source whose *bytes* a third party controls — a remote avatar, an OG/RSS image, a partner CDN object, or any app that mints image URLs for user-supplied sources (the use case `allowedHosts` exists for). Sizes that set both width and height are bounded by the box and are unaffected.

## Recommendation

Add an output pixel budget alongside the input one: after deriving `width`/`height` (and before calling `resize`), compute the projected output dimensions and `throw new ImageError(413, …)` when `projectedWidth * projectedHeight` exceeds a configurable `maxOutputPixels` (defaulting to `maxPixels`). Clamping the aspect-ratio-derived dimension to that budget rather than throwing is also acceptable. Consider defaulting `withoutEnlargement` to `true` for single-dimension sizes.

## Revalidation

**Verdict:** true-positive

Confirmed against both the code and Bun's own documentation, which I read rather than assumed. Bun's `/docs/runtime/image` page says of `maxPixels`: 'Reject if width*height > this. Checked after reading the header, before allocating the pixel buffer' — unambiguously an input-side guard — and adds 'A decoded image takes 4 bytes per pixel'. `resize.ts` passes it only to the constructor (L52, and L144 for placeholders) and nothing anywhere bounds the output. The same page documents `img.resize(800)` as 'width 800, keep aspect ratio', which is exactly the `pipe.resize(width, undefined, resizeOpts)` call at L85 for a width-only size; and `withoutEnlargement: p.withoutEnlargement ?? false` (config.ts:55) leaves upscaling on by default, so the amplification is not clipped at the source dimensions. The height-only path at L75-77 is no safer: the width is derived as `meta.width * (height / meta.height)` with no cap, and because the `fit: 'inside'` box is itself derived from that ratio, 'inside' does not constrain the result. So a 1 x 100,000 px source — a few hundred bytes, only 100k pixels, far under the 50 MP default — becomes 1600 x 160,000,000 under the canonical documented `{ width: 1600 }`. The one thing I could not settle statically is the exact failure mode: whether libvips/Bun refuses the resize, whether a ~1 TB allocation is rejected by the allocator heuristic, or whether the process is OOM-killed. That matters less than it looks, because the attacker can tune the ratio down to the band that succeeds — a 1 x 500 source at `{ width: 1600 }` is 1600 x 800,000 ≈ 1.28e9 px ≈ 5 GB, large enough to exhaust a typical container and small enough to be allocated — so 'unbounded output allocation driven by input the guard does not cover' is correct even if the headline 1 TB figure resolves to a caught encode error. Reachability needs the transformed source's *bytes* to be third-party controlled (remote avatar, partner CDN, or the user-supplied-`src` pattern the docs bless), which is a real but app-dependent precondition, so MEDIUM is right. The sharpest part of the finding is that `maxPixels` is the exact knob `types.ts:76/123` and the docs point operators at for untrusted input, and a fully hardened `maxPixels` does not stop this — an output budget is genuinely missing.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-21)
