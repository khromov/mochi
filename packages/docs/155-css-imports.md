---
title: 'CSS imports'
slug: css-imports
description: 'Import CSS from Svelte, TypeScript, or JavaScript files and have it bundled and injected automatically.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
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

### Variable fonts

Bun's CSS bundler unquotes `format('woff2-variations')` to `format(woff2-variations)`. Browsers silently drop the unquoted form. After bundling, Mochi re-quotes the four `*-variations` hints (`woff2-variations`, `woff-variations`, `truetype-variations`, `opentype-variations`), so `@fontsource-variable/*` packages work with no manual workaround.

### Dev mode

A `.css` edit triggers a fast rebundle and a page reload, with no SSR recompile. Edits to `.svelte` or `.ts` files go through the full compile path.

<SeeItInAction
demos={[
{ href: "https://demos.mochi.fast/todo/", title: "Tailwind Todo App", hook: "Classic todo app styled with Tailwind CSS." },
{ href: "/demos/lazy/", title: "Lazy Islands", hook: "Islands hydrate and load their CSS only when scrolled into view." },
]}
/>
