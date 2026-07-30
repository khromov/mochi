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

It is opt-in. Install the adapter package:

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

The default is `'svelte'`.

<Callout type="warning">

rsvelte is pre-1.0. Its authors note that APIs and behavior may change without notice.

</Callout>

### Without touching code

`MOCHI_SVELTE_COMPILER` overrides the option, which is the easy way to A/B a build:

```sh
MOCHI_SVELTE_COMPILER=rsvelte bun run build
MOCHI_SVELTE_COMPILER=svelte bun run build
```

Mochi logs which compiler it resolved (`Svelte compiler: rsvelte@0.2.8+svelte5.56.4`) once at startup. That line is also how you confirm a build ran on rsvelte, since the fallback is silent.

### Benchmark

This benchmark shows the gains on a small application (the `demos` preset from the CLI):

| phase           | svelte | rsvelte |    delta |
| --------------- | -----: | ------: | -------: |
| total           |  384ms |   289ms | **−25%** |
| `ssr-build`     |  213ms |   137ms | **−36%** |
| `client-bundle` |   40ms |    26ms | **−35%** |

(10 cold-start runs, median value)

### What runs on rsvelte

Only `compile()` and `compileModule()` run on rsvelte. **Parsing and preprocessing always stay on the official compiler**, so islands, `mochi:hydrate*`, `mochi:defer`, and user preprocessors behave identically either way.

### If it cannot load

Prebuilt binaries cover macOS arm64/x64, Linux x64/arm64 (glibc), and Windows x64 (MSVC). There is no musl build, so Alpine-based images are unsupported. When the package is missing or its binary fails to load, Mochi logs a warning and compiles with `svelte/compiler`.

### Known divergences

Production output should generally be byte-identical to `svelte/compiler`. Three differences remain:

- **`cssHash` and `warningFilter`** in `svelte.config.js` are functions and cannot cross the native boundary. They are stripped with a one-time warning. Use rsvelte's `cssHashOverride: '<hash>'` to force a fixed CSS hash.
- **Dev-only instrumentation** is not always reproduced. This affects development builds only. Production output matches.
- **`compileModule()`** emits a `vVERSION` placeholder in its header comment and different printer whitespace. Semantically identical.
