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

See the [Svelte Shaker docs](https://mochi.fast/docs/svelte-shaker/) for the caveats, the size
report and the full option reference.
