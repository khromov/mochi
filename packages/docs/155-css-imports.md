---
title: 'CSS imports'
slug: css-imports
description: 'Import CSS from Svelte, TypeScript, or JavaScript files and have it bundled and injected automatically.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## CSS imports

A side-effect `import` of a `.css` file from any `.svelte`, `.ts`, or `.js` module bundles the stylesheet out-of-band and links it from the page `<head>`. Mochi strips the import from both the SSR and client JavaScript bundles, so the CSS content never ships through JavaScript.

```svelte
<!-- file: src/Page.svelte -->
<script>
  import '@fontsource/inter';
  import 'tippy.js/dist/tippy.css';
</script>
```

Bare specifiers resolve through `package.json#main`, so `@fontsource/*`, CSS-only libraries, and any package that points its main entry at a stylesheet work the same way. Relative paths (`import './styles.css'`) resolve from the importing file.

Mochi serves the bundle as `/_mochi/import-css/<name>-<hash>.css` (with `assetPrefix` configurable on `Mochi.serve`). It tracks the imports reachable from each page entry and injects a `<link rel="stylesheet">` only on pages that use them.

The import can live anywhere in the dependency graph — a leaf `.ts` module, a hydratable island, or the page component. Mochi follows the bundle, not the call site.

<Callout type="warning">

A failed CSS import (missing package, malformed file) surfaces as a `css-bundle-failed` entry in the dev error overlay and as an inline `console.error` in the browser. Fix the path. The side-effect strip fires only on `.css` files Bun can resolve.

</Callout>

### Component-scoped `<style>` blocks

The Svelte compiler handles `<style>` inside a `.svelte` file. Mochi extracts the compiled CSS, hashes it, and serves it from `/_mochi/css/<component>-<hash>.css`. This path is independent of side-effect CSS imports and applies to every component the page renders.

```svelte
<!-- file: src/Card.svelte -->
<h2>Card</h2>

<style>
  h2 {
    color: tomato;
  }
</style>
```

### Fonts

<VersionNote since="0.10.0" message="Earlier versions inline every font into the bundled CSS as a base64 data: URI." />

Fonts larger than 4 kB are served as content-hashed files from `/_mochi/fonts/*` instead of being inlined into the stylesheet:

```css
/* @fontsource/source-sans-pro ships */
src: url(./files/source-sans-pro-latin-400-normal.woff2) format('woff2');

/* Mochi serves */
src: url(/_mochi/fonts/source-sans-pro-latin-400-normal-1bfe8b9c.woff2) format(woff2);
```

Tunable via `Mochi.serve({ fonts })`:

```ts
await Mochi.serve({
  fonts: {
    inlineThreshold: 4096, // fonts at or below this stay inlined, up to Bun's 128 kB ceiling
    dropLegacyWoff: true, // drop format('woff') sources when the face also offers woff2
    preload: true, // <link rel="preload" as="font"> for the page's latin-visible woff2 fonts
  },
  routes,
});
```

- **`dropLegacyWoff`** — `woff2` is supported by every browser Mochi targets, so shipping the `woff` fallback doubles a face's payload for nothing.
- **`preload`** — separately-fetched fonts are only discovered after the CSS arrives; preloading from the `<head>` closes that gap. Faces whose `unicode-range` excludes latin are skipped, and at most 8 fonts are preloaded per page.
- **`inlineThreshold`** — Bun writes any `url()` asset of 128 kB or more to a file of its own, so fonts that large are always served separately whatever this is set to. That 128 kB cutoff is hardcoded in Bun and cannot currently be configured. Non-font assets over it (a background image, say) are served alongside the stylesheet; smaller ones stay inlined.

### Font subsetting

<VersionNote since="0.10.0" message="Earlier versions ignore import attributes on CSS imports and ship the full font." />

A decorative font used for one line of text ships every glyph it has. Put the text on the import instead, and Mochi keeps only the glyphs that text needs:

```svelte
<!-- file: src/Hero.svelte -->
<script>
  import '@fontsource-variable/caveat' with { subset: "It's animated!", weight: '500' };
</script>

<p class="note">It's animated!</p>
```

Attributes are strings, and all of them are optional apart from one of `subset` / `unicodeRange`:

| Attribute       | Keeps                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `subset`        | The characters of this text.                                                                              |
| `unicodeRange`  | Codepoint ranges in CSS syntax: `'U+0020-007E, U+00A0-00FF'`.                                             |
| `weight`        | Pins the `wght` axis of a variable font to one value, instancing it to a static face.                     |
| `axes`          | Pins other axes: `'wdth=87.5, slnt=-10'`.                                                                 |
| `layoutClosure` | `'full'` (default) keeps ligatures and contextual alternates the text could trigger; `'none'` drops them. |

Caveat's latin file is 75 kB. With the text alone it is 8 kB; pinned to weight 500, 5 kB; without layout closure, 2.4 kB — under `inlineThreshold`, so it lands in the stylesheet as a `data:` URI and the page makes no font request and needs no preload. Each `mochi-framework build` and dev rebundle logs the before/after size per font.

To change which glyphs are kept, change the string. Sites that import the same stylesheet merge their requests: two components asking for `'Hello'` and `'World'` share one file holding both. A different `weight` (or `axes`, or `layoutClosure`) becomes a second `@font-face` for the same family, with its `font-weight` descriptor rewritten to the pinned value so the browser picks the right one. Faces whose `unicode-range` shares nothing with the request (the cyrillic file, for latin text) are dropped from the stylesheet.

The attribute works from `.ts` and `.js` modules too. Subsetting runs where the font is extracted, so a subset above the threshold is served and preloaded like any other font, and its filename is a hash of the subset bytes.

<Callout type="warning">

A character the subset lacks renders in the next font of the `font-family` stack, and nothing in the build can tell — only the cascade knows which text ends up in which family. In dev, Mochi checks the rendered page in the browser after fonts load and warns in the console (and the debug bar) with the missing characters. Pin `weight` only when every use of the family is that weight; text asking for another weight falls back to synthesis.

</Callout>

Subsetting needs the optional [`subset-font`](https://www.npmjs.com/package/subset-font) package (HarfBuzz compiled to WebAssembly, loaded only when an import carries a `subset`): `bun add -d subset-font`. Without it a `subset` import is a build error. `fonts: { subset: false }` ignores the attributes everywhere and ships the full fonts, which is the quickest way to check whether a subset is what changed a glyph.

### Dev mode

A `.css` edit triggers a fast rebundle and a page reload, with no SSR recompile. Edits to `.svelte` or `.ts` files go through the full compile path.

<SeeItInAction
demos={[
{ href: "https://demos.mochi.fast/todo/", title: "Tailwind Todo App", hook: "Classic todo app styled with Tailwind CSS." },
{ href: "/demos/lazy/", title: "Lazy Islands", hook: "Islands hydrate and load their CSS only when scrolled into view." },
]}
/>
