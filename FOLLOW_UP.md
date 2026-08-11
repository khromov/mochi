# Follow-up: generalize CSS asset emission beyond fonts

Status: planned, not started. Context lives in PR #292 (`feat/font-asset-extraction`), which emits **fonts** referenced from imported CSS as separate content-hashed assets. Vite has no extension filter at all here — _any_ `url()`-resolvable file in CSS becomes an emitted asset (images, SVGs, cursors, …). This document is the plan for reaching that parity in Mochi.

## Why

Bun's CSS bundler base64-inlines every `url()` reference unconditionally, so a large background image or sprite sheet in an imported stylesheet has exactly the problem fonts had: it bloats a render-blocking stylesheet, inflates ~33% over the binary, and loses independent caching. The fonts PR fixed this for `.woff2/.woff/.ttf/.otf/.eot` only.

## Empirical findings to build on (verified on Bun 1.3.14 — re-verify on the current pin)

- Plugin `onResolve`/`onLoad` hooks **do** fire for `url()` references inside CSS-entrypoint `Bun.build` calls. `onLoad` receives the fully-resolved absolute path (any `@import` depth, packages, exports maps — Bun's resolver owns it).
- Dead ends: the CSS build's `metafile.inputs` is empty; `onResolve` returning `{ path, external: true }` prevents inlining but **ignores** the rewritten path (original source text is kept); `onLoad` returning bytes with `loader: 'file'` + `publicPath`/`naming.asset` still inlines.
- Working mechanism (**marker technique**, same architecture as lightningcss `analyzeDependencies` placeholders that Vite uses): `onLoad` returns tiny unique marker bytes (`__MOCHI_FONT_<i>__`) with `loader: 'file'`. The bundled CSS then contains exactly `url("data:<mime>;base64,<base64(marker)>")` — substitutable by exact string match, no CSS parsing needed for the rewrite. The MIME is stamped by Bun from the file extension; capture it from the output rather than re-deriving it.

## Existing implementation to extend

- `packages/mochi/src/compiler/cssFontAssets.ts` — `createFontMarkerPlugin` (onLoad filter `/\.(woff2?|ttf|otf|eot)$/`, threshold check via `statSync`, marker refs), `classifyFontAssets` (@font-face parsing for `dropLegacyWoff` + `unicode-range` preload classification, survivor detection), `fontAssetFileName` (`<basename>-<sha256:8>.<ext>`).
- `packages/mochi/src/compiler/ComponentRegistry.ts` — `bundleImportedCss()`: plugin wiring, survivor read/hash/write to `<outDir>/fonts/`, exact `replaceAll` of `url("<markerUri>")` → `url(<assetPrefix>/fonts/<file>)`, registration in `fontAssets` map + `importedCssFontPreloads` + `importedCssStats`. Cleared in `rebundleImportedCss()` and `clearCompileCache()`.
- Serving: `Mochi.ts` `composedFetch` — `registry.getFontAsset(pathname)` → `Bun.file` response with stored content type + immutable caching. Manifest v3: `fontAssets` (outDir-relative diskPath) + `importedCssFontPreloads`, restored in `fromManifest`.

## Design deltas for images/generic assets

1. **Plugin filter**: widen (or add a second plugin) to image/generic extensions — start with `KNOWN_ASSET_TYPES`-style list (png, jpg/jpeg, gif, webp, avif, svg, ico, bmp; consider mp4/webm/mp3 later). Marker prefix per class (`__MOCHI_CSSASSET_<i>__`) or just reuse one ref list with a `kind` field.
2. **No font-face semantics**: images need none of `classifyFontAssets`' `@font-face` logic — no `dropLegacyWoff`, no preload classification. Plain survivor substitution: every marker URI found in the CSS gets its file emitted and URL substituted. (Keep fonts on the existing path.)
3. **SVG caveat** (from Vite): Vite inlines SVG as URL-encoded (not base64) data URIs and skips inlining SVGs referenced with a `#fragment` (they're meant to be reused). Decide whether small-SVG inlining via Bun (base64) is acceptable or SVGs should always be emitted.
4. **Threshold**: Vite uses one `assetsInlineLimit` (default 4096 raw bytes, strict `<`) for everything. Options: reuse `fonts.inlineThreshold` semantics under a generalized `Mochi.serve({ assets })` option, or keep `fonts` and add `cssAssets: { inlineThreshold }`. Prefer one shared option with the fonts option becoming an alias/subsection — decide with the maintainer.
5. **Serving + naming**: reuse the exact `fontAssetFileName` scheme and the serving branch — likely rename the registry map (`fontAssets` → `cssAssets`) and the URL namespace (`/_mochi/fonts/` → keep for fonts; images could serve under `/_mochi/css-assets/` or reuse the image runtime). **Check interaction with the existing image pipeline**: locally-imported images (`import x from './x.png'`) already flow through `compiler/imageAssetLoader.ts` → `image/localAssetRegistry.ts` and are served/transformable via the image runtime. CSS-referenced images could either join `localImageAssets` (gaining the image runtime's content-type handling) or stay dumb static binaries like fonts. Joining `localImageAssets` is probably less new surface.
6. **Manifest**: new/renamed map means a manifest schema consideration — extending `fontAssets` into a general family or adding a sibling key. Adding an optional sibling key does not break old-manifest loading, but bump `MANIFEST_VERSION` anyway if the CSS output references URLs an older runtime wouldn't serve (same reasoning as the fonts PR bumping v2→v3).
7. **Stats/docs**: extend `importedCssStats` entries (`fonts/<file>` → also `css-assets/<file>`), document on `packages/docs/155-css-imports.md` next to the Fonts section with a `VersionNote`.

## Verification recipe

- Scratchpad probes (pattern from the fonts work): tiny CSS + fake binary + `Bun.build` with the widened plugin; assert marker URIs in output, then substitution.
- Unit tests: mirror `packages/mochi/src/compiler/cssFontAssets.test.ts` (synthetic marker CSS); integration mirror of `cssFontImports.test.ts` (generated fixtures in a mkdtemp **inside `packages/mochi/`** — see CLAUDE.md on outDir placement) covering: large image emitted + URL rewritten, small image stays inline, manifest round-trip, threshold opt-out.
- Smoke: add/extend a demo (`packages/site`) with a CSS `background-image` from an imported stylesheet; `bun run dev:site`, verify separate asset response + shrunken CSS; chrome-devtools console/network check; teardown via `pkill -f dev:site`.
- `bun run checks` via a Sonnet sub-agent (30-min timeout) before calling it done.
