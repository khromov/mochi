---
title: 'Svelte Shaker optimization'
slug: svelte-shaker
description: 'Optimize and slim down .svelte sources before compilation with the whole-program svelte-shaker optimizer.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Svelte Shaker

[svelte-shaker](https://github.com/baseballyama/svelte-shaker) is a whole-program optimizer that slims `.svelte` _source_ before the Svelte compiler runs — folding props that never vary, removing the dead branches that fold opens up, and narrowing unused CSS. The result is less generated code per component and smaller bundles.

Enable it by passing `optimize: true` to `Mochi.serve()`:

```ts
// src/index.ts
await Mochi.serve({
  port: 3000,
  optimize: true,
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

<Callout type="info">
Shaking runs in <strong>production only</strong>. It is a whole-program pass — folding in one component can change when an unrelated component's call site changes — so it can't be reused per-file across hot reloads. In development the flag is ignored and components compile from their original source.
</Callout>

### Prebuilt manifests

If you prebuild with `mochi-framework build` (see [Deployment](./deployment)), nothing to mirror: the build reads `optimize` straight from the `Mochi.serve()` call in your entry (`src/index.ts` by default, override with `--entry <path>`), so the prebuilt manifest and the runtime can't disagree.

### Excluding components

If the shaker mis-transforms a component, pass `{ exclude }` with cwd-relative globs to compile those files from their original source. Excluding is always safe — the whole-app scan still covers an excluded file as a _call site_ of the components that import it; only its own output is left unshaken.

```ts
await Mochi.serve({
  optimize: {
    enabled: true,
    exclude: ['src/components/ThemeToggle.svelte', 'src/legacy/**'],
  },
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

### Disabling temporarily

Pass `enabled: false` inside the options object to skip shaking while keeping the rest of your config visible:

```ts
await Mochi.serve({
  optimize: {
    enabled: false,
    exclude: ['src/components/ThemeToggle.svelte'],
  },
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

This is equivalent to `optimize: false` but preserves the options so you can re-enable with a single toggle.

### Size report

When shaking runs, a per-component before→after source-byte breakdown is logged automatically:

```
svelte-shaker: slimmed 15 of 86 component(s), 1 excluded
svelte-shaker: source size before → after
  src/components/Sidebar.svelte   3.21 kB → 2.74 kB  (-14.6%)
  …
  total (15 changed)              48.9 kB → 41.2 kB  (-15.7%)
```

The whole-app scan must cover every component for soundness, so the map includes untouched ones too — `slimmed N of M` reports how many the shaker actually changed (`M`) versus the total scanned (the rest are returned verbatim).

### Scope

Only components under `./src` are scanned. Prop folding is sound only when every call site of a component is in scope, so components imported from outside `./src` (e.g. a shared package) are left untouched. If shaking fails for any reason, Mochi logs a warning and falls back to the original, unshaken source.
