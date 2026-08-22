---
title: 'Type checking'
slug: type-checking
description: 'Run svelte-check + tsc against your project; Mochi auto-patches svelte-check so mochi: attributes type-check cleanly.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Type checking

<VersionNote since="0.10.0" message="mochi-framework prepare was added in 0.10.0. Before it, svelte-check was patched through bun's patchedDependencies and a committed patch file pinned to one exact svelte-check version." />

Scaffolded projects ship a `typecheck` script that runs [`svelte-check`](https://www.npmjs.com/package/svelte-check) followed by `tsc`:

```json
// package.json
{
  "scripts": {
    "typecheck": "mochi-framework prepare && svelte-check --tsconfig ./tsconfig.json --compiler-warnings 'attribute_illegal_colon:ignore' && tsc -p tsconfig.json --noEmit"
  }
}
```

```sh
bun run typecheck
```

### Why `mochi-framework prepare`?

svelte-check's type-check pass reads your `.svelte` files raw, so it doesn't recognise Mochi's custom template attributes (`mochi:hydrate`, `mochi:defer`, …) and reports false type errors on them. `mochi-framework prepare` patches the locally-installed svelte-check so those attributes type-check cleanly. It's idempotent and self-healing — safe to run on every check, and it re-applies after a fresh `bun install` or a svelte-check upgrade.

The same patch is applied automatically when you start the dev server, so during normal development you never run it by hand. The explicit `prepare` step exists for CI and fresh checkouts that run `typecheck` without ever starting `dev`.

<Callout type="info">

Unlike bun's `patchedDependencies`, this isn't pinned to an exact svelte-check version — `prepare` matches the insertion site by surrounding code, so it keeps working when you bump svelte-check. If it ever can't patch (e.g. a major svelte-check internal change), it prints a warning instead of failing silently.

</Callout>
