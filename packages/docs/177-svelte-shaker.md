---
title: 'Svelte Shaker'
slug: svelte-shaker
description: 'Slim .svelte source before compilation with the whole-program svelte-shaker optimizer.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Svelte Shaker

[svelte-shaker](https://github.com/baseballyama/svelte-shaker) is a whole-program optimizer that slims `.svelte` _source_ before the Svelte compiler runs — folding props that never vary, removing the dead branches that fold opens up, and narrowing unused CSS. The result is less generated code per component.

Enable it by passing `optimizeWithSvelteShaker: true` to `Mochi.serve()`:

```ts
// src/index.ts
await Mochi.serve({
  port: 3000,
  optimizeWithSvelteShaker: true,
  routes,
});
```

<Callout type="info">
Shaking runs in <strong>production only</strong>, and only on the <strong>client (browser) build</strong> — the server/SSR bundle always compiles original source, since it isn't shipped to the browser so slimming it has no payoff. It is a whole-program pass — folding in one component can change when an unrelated component's call site changes — so it can't be reused per-file across hot reloads. In development the flag is ignored and components compile from their original source.
</Callout>

### Prebuilt manifests

If you prebuild with `mochi-framework build` (see [Deployment](./deployment)), mirror the flag in the `buildOptions` your routes file exports so the manifest is built from shaken source:

```ts
// src/routes.ts
import type { MochiBuildOptions } from 'mochi-framework/build';

export const buildOptions: Pick<MochiBuildOptions, 'optimizeWithSvelteShaker'> = {
  optimizeWithSvelteShaker: true,
};
```

<Callout type="warning">
Keep the two values in sync. The build step reads <code>buildOptions</code>, not your <code>Mochi.serve()</code> call, so a flag set in only one place leaves the prebuilt manifest and the runtime disagreeing.
</Callout>

### Excluding components

If the shaker mis-transforms a component, pass `{ exclude }` with cwd-relative globs to compile those files from their original source. Excluding is always safe — the whole-app scan still covers an excluded file as a _call site_ of the components that import it; only its own output is left unshaken.

```ts
await Mochi.serve({
  optimizeWithSvelteShaker: {
    exclude: ['src/components/ThemeToggle.svelte', 'src/legacy/**'],
  },
  routes,
});
```

<Callout type="info">
svelte-shaker <code>0.2.0</code> mis-handles a <code>class:</code> directive <em>shorthand</em> on a prop it folds (e.g. <code>class:compact</code> when <code>compact</code> never varies) — exclude such a component, or write the class with an explicit expression (<code>class={compact ? 'compact' : ''}</code>).
</Callout>

### Size report

Pass `report: true` to log a per-component before→after source-byte breakdown (sorted by bytes saved) instead of just the one-line summary:

```ts
await Mochi.serve({
  optimizeWithSvelteShaker: { report: true },
  routes,
});
```

```
svelte-shaker: slimmed 15 of 86 component(s), 1 excluded
svelte-shaker: source size before → after
  src/components/Sidebar.svelte   3.21 kB → 2.74 kB  (-14.6%)
  …
  total (15 changed)              48.9 kB → 41.2 kB  (-15.7%)
```

The whole-app scan must cover every component for soundness, so the map includes untouched ones too — `slimmed N of M` reports how many the shaker actually changed (`M`) versus the total scanned (the rest are returned verbatim).

### L2 monomorphization

By default the shaker folds a prop only when it's the _same_ constant across the whole app. **L2** goes further: it gives an individual call site its own specialized copy ("variant") of a child when doing so makes a whole module drop out of the bundle.

The canonical win — `Heavy` survives normal shaking but vanishes under L2:

```svelte
<!-- Child.svelte -->
{#if a === 1 && b === 1}<Heavy />{/if}
<p>base</p>

<!-- the only call sites, app-wide -->
<Child a={0} b={1} />
<!-- and -->
<Child a={1} b={0} />
```

`a` and `b` are each narrowed independently, so plain shaking can't prove `a && b` is never both `1` — `<Heavy />` stays. L2 specializes each site (freezing `a`/`b`), the guard folds to `false` in every variant, and `Heavy` becomes unreferenced. Mochi then drops the now-orphaned `import Heavy` (and the base `Child`) from the slimmed source so Bun's bundler removes the modules from the client bundle.

Enable it with `mono` (off by default):

```ts
await Mochi.serve({
  optimizeWithSvelteShaker: { mono: true },
  routes,
});
// or tune: { mono: { maxVariants: 8, minSavings: 0.15 } }
```

`maxVariants` (default 8) caps the distinct residuals per child; `minSavings` (default 0) is the minimum byte-fraction a specialization must save.

<Callout type="info">
L2 is <strong>measured and never bloats</strong>: a child is specialized only when <em>every</em> live call site folds to a non-base variant <em>and</em> the total reachable bytes strictly shrink — otherwise it keeps the base. Variants are <strong>virtual modules</strong> served from memory during the build; nothing is written to your source tree. Like the rest of the shaker, it runs in production only.
</Callout>

### Scope

Only components under `./src` are scanned. Prop folding is sound only when every call site of a component is in scope, so components imported from outside `./src` (e.g. a shared package) are left untouched. If shaking fails for any reason, Mochi logs a warning and falls back to the original, unshaken source.
