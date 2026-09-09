---
title: 'Type checking'
slug: type-checking
description: 'Make svelte-check and your editor understand the mochi:* directives with the ambient types and a warningFilter in svelte.config.js.'
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

It declares Mochi's asset imports (`*.css`, `*.md`, images) and whitelists the directives on every HTML element and on every component, so `<UserAvatar mochi:defer userId={1} />` type-checks without the component declaring anything.

#### Directives on components

<VersionNote since="0.10.0" message="Directives on components are covered by the ambient types since 0.10.0. Earlier versions only covered HTML elements and patched svelte-check instead." />

svelte2tsx checks a call site against the component's own `$props()` type. Mochi widens that type where svelte2tsx builds it, so the `mochi:*` keys and their option objects are known on every component. Generic components (`<script generics="…">`) are the one exception: svelte2tsx types them separately, so intersect `MochiDirectives` into their props yourself:

```svelte
<!-- file: src/List.svelte -->
<script lang="ts" generics="T">
  import type { MochiDirectives } from 'mochi-framework';

  let { items }: { items: T[] } & MochiDirectives = $props();
</script>
```

<Callout type="info">

Projects scaffolded before 0.10.0 patch `svelte-check` instead (`patches/svelte-check@….patch` via `patchedDependencies`). The patch only reaches the CLI — editors bundle their own copy of svelte2tsx and keep reporting the error. After upgrading, delete the `patches/` directory and the `patchedDependencies` entry in `package.json`; the ambient types cover both.

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
