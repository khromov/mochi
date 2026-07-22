---
title: 'rsvelte compiler'
slug: rsvelte
description: 'Swap the JavaScript Svelte compiler for rsvelte, a Rust port built on OXC, to cut compile time.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## rsvelte

[rsvelte](https://github.com/baseballyama/rsvelte) is a Rust port of the Svelte 5 compiler built on [OXC](https://oxc.rs/). Mochi can route component compilation through it instead of the JavaScript `svelte/compiler`, which speeds up cold builds and dev rebuilds.

It's opt-in. Install the adapter package:

```sh
bun add -d @mochi-framework/rsvelte
```

Then pass `svelteCompiler`:

```ts
// src/index.ts
await Mochi.serve({
  port: 3000,
  svelteCompiler: 'rsvelte',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

The default is `'svelte'` — without the option nothing changes.

<Callout type="warning">

rsvelte is pre-1.0 and its authors note that APIs and behaviour may change without notice.

</Callout>

### Without touching code

`MOCHI_SVELTE_COMPILER` overrides the option, which is the easy way to A/B a build:

```sh
MOCHI_SVELTE_COMPILER=rsvelte bun run build
MOCHI_SVELTE_COMPILER=svelte bun run build
```

Mochi logs which compiler it resolved (`Svelte compiler: rsvelte@5.56.4`) once at startup.

<Callout type="info">

A prebuilt `manifest.json` bakes already-compiled output, and unlike the in-memory compile cache it isn't keyed on the compiler. Run `bun run clean` before rebuilding after a switch, or you'll measure the old compiler's output.

</Callout>

### What runs on rsvelte

Only `compile()` and `compileModule()`. Mochi's island preprocessor walks a real Svelte AST with `zimmerframe`, and rsvelte's `parse()` returns a JSON string rather than an upstream-shaped AST — so **parsing and preprocessing always stay on the official compiler**. Islands, `mochi:hydrate*`, `mochi:defer` and user preprocessors behave identically either way.

### If it can't load

Prebuilt binaries cover macOS arm64/x64, Linux x64/arm64 (glibc) and Windows x64 (MSVC). There's no musl build, so Alpine-based images aren't supported. When the package is missing or its binary won't load, Mochi logs a warning and compiles with `svelte/compiler` — the build never fails over it.

### Known divergences

Production output is byte-identical to `svelte/compiler` across the constructs Mochi's parity suite covers. Three differences remain:

- **`cssHash` and `warningFilter`** in `svelte.config.js` are functions and can't cross the native boundary. They're stripped with a one-time warning; use rsvelte's `cssHashOverride: '<hash>'` to force a fixed CSS hash.
- **Dev-only instrumentation** is not always reproduced — `$derived(await …)` loses its reactivity-loss warning, `$effect` differs in state-logging, and snippets skip two dev arg-validation guards. Development builds only; production output matches.
- **`compileModule()`** emits a `vVERSION` placeholder in its header comment and different printer whitespace. Semantically identical.
