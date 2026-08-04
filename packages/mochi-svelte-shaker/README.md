# @mochi-framework/svelte-shaker

Opt-in [svelte-shaker](https://github.com/baseballyama/svelte-shaker) optimizer for `mochi-framework`.
svelte-shaker is a whole-program optimizer that slims `.svelte` _source_ before the Svelte compiler
runs — folding props that never vary, removing the dead branches that fold opens up, and narrowing
unused CSS. This package adapts it to Mochi's optimizer contract and owns its dependency tree, so
apps that don't opt in never install it.

## Install

```sh
bun add -d @mochi-framework/svelte-shaker
```

## Use

Enable it with `optimize` on `Mochi.serve()`:

```ts
await Mochi.serve({
  optimize: true,
  routes,
});
```

Or pass an object to exclude components the shaker mis-transforms:

```ts
await Mochi.serve({
  optimize: {
    enabled: true,
    exclude: ['src/components/ThemeToggle.svelte', 'src/legacy/**'],
  },
  routes,
});
```

If this package isn't installed, Mochi logs one warning and compiles from the original sources.
Builds never fail over it. See the [Svelte Shaker docs](https://mochi.fast/docs/svelte-shaker/)
for the size report and the full option reference.

## Caveats

- **Production only.** Shaking is a whole-program pass — folding in one component can change when
  an unrelated component's call site changes — so it can't be reused per-file across hot reloads.
  In development the flag is ignored.
- **Runes only.** svelte-shaker supports Svelte 5 runes syntax, not Svelte 4 legacy syntax.
- **Scope is `./src`.** Prop folding is sound only when every call site of a component is in scope,
  so components imported from outside `./src` are left untouched.
- **Pre-1.0.** Mochi drives svelte-shaker's internal `svelte-shaker/node` subpath, which can move
  between releases — hence the `>=0.18.1` floor rather than a caret range. Below 0.18.1 the shaker
  strips `mochi:*` directives, silently turning islands into plain components.
