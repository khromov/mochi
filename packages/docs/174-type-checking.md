---
title: 'Type checking'
slug: type-checking
description: 'Make svelte-check and your editor understand the mochi:* directives with MochiDirectives and a warningFilter in svelte.config.js.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Type checking

Scaffolded projects ship a `typecheck` script that runs [`svelte-check`](https://www.npmjs.com/package/svelte-check) and then `tsc`:

```sh
bun run typecheck
```

Both tools, and the Svelte VS Code extension, read `.svelte` files raw. They see the `mochi:*` directives that Mochi strips before the Svelte compiler runs, so two small additions keep them quiet.

### Ambient types

Reference `mochi-framework/ambient` from a `.d.ts` file in your project. Scaffolds do this in `src/global.d.ts`:

```ts
// file: src/global.d.ts
/// <reference types="mochi-framework/ambient" />
```

It whitelists the directives on every HTML element and declares Mochi's asset imports (`*.css`, `*.md`, images).

### `MochiDirectives` for island components

<VersionNote since="0.10.0" message="MochiDirectives was added in 0.10.0." />

TypeScript checks `<Island mochi:defer />` against the island's own `$props()` type, so the directive is reported as an unknown property:

```
Object literal may only specify known properties, and '"mochi:defer"' does not exist in type '$$ComponentProps'. ts(2353)
```

Intersect `MochiDirectives` into the props type of any component you mark with a directive:

```svelte
<!-- file: src/UserAvatar.svelte -->
<script lang="ts">
  import type { MochiDirectives } from 'mochi-framework';

  let { userId }: { userId: number } & MochiDirectives = $props();
</script>
```

A component without props of its own still needs the declaration:

```svelte
<script lang="ts">
  import type { MochiDirectives } from 'mochi-framework';

  let {}: MochiDirectives = $props();
</script>
```

The component never receives the directives — Mochi consumes them at compile time — but the type tells TypeScript they are allowed at the call site. It covers `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, `mochi:defer:visible`, `mochi:clientOnly` and `mochi:clientOnly:visible`, including their option objects, and it is the same type the ambient augmentation uses for HTML elements.

<Callout type="info">

Projects scaffolded before 0.10.0 instead patch `svelte-check` (`patches/svelte-check@….patch` via `patchedDependencies`). The patch only reaches the CLI: editors bundle their own copy of svelte2tsx and keep reporting the error, which `MochiDirectives` fixes everywhere.

</Callout>

### `attribute_illegal_colon`

The Svelte compiler warns about the colon in every `mochi:*` attribute. Filter it in `svelte.config.js`; `svelte-check` and the VS Code extension both read that file:

```js
// file: svelte.config.js
export default {
  compilerOptions: {
    experimental: { async: true },
    warningFilter: (warning) => warning.code !== 'attribute_illegal_colon',
  },
};
```

Scaffolds ship this filter. If yours predates it, adding the line replaces the `--compiler-warnings 'attribute_illegal_colon:ignore'` flag in the `typecheck` script.
