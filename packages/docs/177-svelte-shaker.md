---
title: 'Svelte Shaker optimization'
slug: svelte-shaker
description: 'Optimize and slim .svelte sources before compilation with the whole-program svelte-shaker optimizer.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Svelte Shaker

[svelte-shaker](https://github.com/baseballyama/svelte-shaker) is a whole-program optimizer that slims `.svelte` **source** before the Svelte compiler runs. It folds props that never vary, removes the dead branches that folding opens up, and narrows unused CSS. The result is less generated code per component and smaller bundles.

Enable it with `optimize: true` on `Mochi.serve()`:

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

Shaking runs in **production only**. It is a whole-program pass — folding in one component can change when an unrelated component's call site changes — so it cannot be reused per file across hot reloads. In development the flag is ignored and components compile from their original source.

</Callout>

### Excluding components

If the shaker mis-transforms a component or you hit build-time errors, pass `{ exclude }` with cwd-relative globs to compile those files from their original source. Excluding is safe — the whole-app scan still covers an excluded file as a call site of the components that import it. Only its own output is left unshaken.

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

<Callout type="warning">

The svelte-shaker package supports Svelte 5 Runes syntax only, not Svelte 4 legacy syntax.

</Callout>

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

This equals `optimize: false` but preserves the options so you can re-enable with one toggle.

### Size report

When shaking runs, Mochi logs a per-component before→after source-byte breakdown:

```
svelte-shaker: slimmed 15 of 86 component(s), 1 excluded
svelte-shaker: source size before → after
  src/components/Sidebar.svelte   3.21 kB → 2.74 kB  (-14.6%)
  …
  total (15 changed)              48.9 kB → 41.2 kB  (-15.7%)
```

`slimmed N of M` reports how many components the shaker changed versus the total scanned.

### Scope

Only components under `./src` are scanned. Prop folding is sound only when every call site of a component is in scope, so components imported from outside `./src` (a shared package) are left untouched. If shaking fails, Mochi logs a warning and falls back to the original source.
