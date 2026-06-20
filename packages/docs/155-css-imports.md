---
title: 'CSS imports'
slug: css-imports
description: 'Import CSS from Svelte, TypeScript, or JavaScript files and have it bundled and injected automatically.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## CSS imports

Side-effect `import` of a `.css` file from any `.svelte`, `.ts`, or `.js` module bundles the stylesheet out-of-band and links it from the page `<head>`. The import is stripped from both the SSR and client JS bundles, so the `.css` content never ships through JavaScript.

```svelte
<!-- file: src/Page.svelte -->
<script>
  import '@fontsource/inter';
  import 'tippy.js/dist/tippy.css';
</script>
```

Bare specifiers resolve through `package.json#main`, so `@fontsource/*`, CSS-only libraries, and any package that points its main entry at a stylesheet all work the same way. Relative paths (`import './styles.css'`) resolve from the importing file.

The bundle is served as `/_mochi/import-css/<name>-<hash>.css` (with `assetPrefix` configurable on `Mochi.serve`). Mochi tracks the imports reachable from each page entry and injects a `<link rel="stylesheet">` only on pages that actually use them.

```ts
// file: src/lib/icons.ts
import 'tippy.js/dist/tippy.css';
```

The import can live anywhere in the dependency graph — a leaf `.ts` module, a hydratable island, or the page component itself. Mochi follows the bundle, not the call site.

<Callout type="warning">

A failed CSS import (missing package, malformed file) surfaces as a `css-bundle-failed` entry in the dev error overlay and as an inline `console.error` in the browser. Fix the path; the side-effect strip only fires on `.css` files Bun could resolve.

</Callout>

### Component-scoped `<style>` blocks

`<style>` inside a `.svelte` file is handled by the Svelte compiler — Mochi extracts the compiled CSS, hashes it, and serves it from `/_mochi/css/<component>-<hash>.css`. This path is independent of side-effect CSS imports and applies to every component the page renders.

```svelte
<!-- file: src/Card.svelte -->
<h2>Card</h2>

<style>
  h2 {
    color: tomato;
  }
</style>
```

<Callout type="warning">

**Load each stylesheet through one mechanism.** Importing the same CSS from both a `<style>` block and a side-effect `import` ships it twice. Use `<style>` for component-local rules and `import './foo.css'` for shared/global stylesheets.

</Callout>

### Variable fonts

Bun's CSS bundler unquotes `format('woff2-variations')` to `format(woff2-variations)`, which browsers silently drop. Mochi re-quotes the four `*-variations` hints (`woff2-variations`, `woff-variations`, `truetype-variations`, `opentype-variations`) after bundling, so `@fontsource-variable/*` packages work without manual workarounds.

### Dev mode

A `.css` edit triggers a fast rebundle and a page reload — no SSR recompile. Edits to `.svelte` or `.ts` files go through the full compile path.
