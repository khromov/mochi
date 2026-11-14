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

<VersionNote since="0.10.0" message="Earlier versions link the stylesheet of every component in the page's import graph." />

Only components that actually rendered get a `<link>`: a component behind an untaken `{#if}`, or one of several variants a parent picks between, ships no CSS on that response. Hydrated islands are the exception. A hydrated island can render a component in the browser that never rendered on the server, so every styled component in its import graph stays linked whenever the island is on the page.

A `mochi:defer` island adds only the styles of its fallback to the page. Its fragment names the stylesheets it rendered, and the island loads them before it replaces the fallback, so the content never shows unstyled.

<Callout type="info">

A component whose `<style>` has `:global(...)` rules, selectors Svelte leaves unscoped (`:root`, `:host` or `::view-transition*` on their own), or unscoped at-rules such as `@font-face`, is always linked, rendered or not: those rules apply to the whole page, so they keep the old behaviour. Move them to a side-effect CSS import if the component should be prunable. The same goes for a component that exports snippets from `<script module>`.

</Callout>

<Callout type="warning">

A component counts as rendered only when it renders during the request. If you cache the HTML of a `render()` call and reuse it with `{@html}`, later requests do not link that component's stylesheet. Render it in the request instead, or import the same styles as a side-effect CSS import.

</Callout>

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

A font file carries every glyph, and a variable one every weight. When you know the text a font renders, put it on the import and Mochi strips the file down to those glyphs — a 75 kB file becomes a few kB, small enough to inline:

```svelte
<!-- file: src/Hero.svelte -->
<script>
  import '@fontsource-variable/caveat' with { subset: "It's animated!", weight: '500' };
</script>

<p class="note">It's animated!</p>
```

| Attribute       | Effect                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `subset`        | Required. Keeps the characters of this text.                                                   |
| `weight`        | Pins a variable font's `wght` axis to one value.                                               |
| `layoutClosure` | `'full'` (default) keeps ligatures and alternates the text could trigger; `'none'` drops them. |

To change which glyphs are kept, change the string. The attributes work from `.ts` and `.js` modules too.

Each page gets the font its own imports ask for, and pages that ask for the same glyphs share one file. When several components on a page import the same stylesheet:

- Their text merges into one file.
- A different `weight` gets a file of its own, unless one import leaves `weight` out — then the page keeps one variable font.
- Layout closure is dropped only when every import asks for `'none'`.
- An import without `subset` asks for the whole font, so the page ships it unsubsetted.

Mochi logs a warning when imports on one page cannot all be honoured as written: a subset beside an import without one, a pinned `weight` beside an unpinned one, or differing layout closure.

<Callout type="warning">

The limitation is that you must know the text at build time. A character the subset lacks renders in the next font of the stack; in dev, Mochi checks the rendered page after fonts load and warns in the console with the missing characters.

</Callout>

### Dev mode

A `.css` edit triggers a fast rebundle and a page reload, with no SSR recompile. Edits to `.svelte` or `.ts` files go through the full compile path.

<SeeItInAction
demos={[
{ href: "https://demos.mochi.fast/todo/", title: "Tailwind Todo App", hook: "Classic todo app styled with Tailwind CSS." },
{ href: "/demos/lazy/", title: "Lazy Islands", hook: "Islands hydrate and load their CSS only when scrolled into view." },
]}
/>
