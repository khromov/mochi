---
title: 'Build-time values'
slug: compiled
description: 'Evaluate a function at build time with compiled() and inline its result, so the code that produced it never ships.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Build-time values

<VersionNote since="0.10.0" message="compiled() and moduleRef() are not in the published release yet. This page describes the upcoming API." />

`compiled()` runs a function while your app compiles and inlines whatever it returned. The function, and everything it imports, is left out of the bundle.

```svelte
<script>
  import { compiled } from 'mochi-framework';
  import { loadSources } from './lib/sources.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>
```

The compiled output holds the finished value, not the call:

```js
const sources = [{ label: 'App.svelte', html: '<pre>…</pre>' }];
```

`loadSources` and `files` are gone. So is anything they imported — which is the point: a syntax highlighter, a markdown parser, or a database client used only to produce the value stops being a runtime dependency.

Works in `.svelte`, `.md`/`.svx`, and plain `.ts` modules. The function may be async; the build awaits it.

### What the function may reference

Only module-level imports and globals. A reference to a local binding is a compile error that names it:

```svelte
<script>
  const limit = 10;
  // ✗ compiled() can only reference module-level imports and globals,
  //   but this expression references "limit".
  const rows = await compiled(() => query(limit));
</script>
```

Move the value into its own module and import it. The restriction is what keeps runes like `$props()` and `$derived` out of code that runs during a build, where no component instance exists.

<Callout type="info">

Mochi strips the `await` along with the call, since the inlined value is a plain literal. You do not need `experimental.async` to use `compiled()` at the top level of a component.

</Callout>

### Returning components with `moduleRef()`

A component cannot be serialized. `moduleRef()` marks a module to import instead, and the build turns each marker into a real `import`:

```ts
// src/lib/docs.compiled.ts
import { compiled, moduleRef } from 'mochi-framework';
import type { Component } from 'svelte';
import { loadDocs } from './docs';

export const docs: Record<string, Component> = await compiled(async () => {
  const entries = await loadDocs();
  return Object.fromEntries(entries.map((d) => [d.slug, moduleRef<Component>(`../../docs/${d.filename}`)]));
});
```

becomes:

```js
import __mochi_ref_0__ from '/abs/path/docs/10-intro.md';
export const docs = { intro: __mochi_ref_0__ };
```

This replaces the usual pattern of generating a barrel file into your source tree before every build. The map stays typed against the real module, so `svelte-check` and `tsc` work with no generated file on disk.

### Serialization

Values are serialized with [devalue](https://github.com/sveltejs/devalue), so `Date`, `Map`, `Set`, `RegExp`, `BigInt`, `undefined`, cycles, and repeated references all survive. Functions, class instances, and promises do not.

### Unused imports are removed

After inlining, an import that only fed the function is deleted. That is what actually drops the dependency: a module with top-level side effects is not tree-shakeable, so leaving the import in place would ship the whole library. An import still used anywhere else — including in your markup — is kept.

### What the build reports

`mochi-framework build` prints every call it evaluated:

```
      Build-time values
  ┌ ✦ 1× compiled() in src/demos/url/Url.svelte
  └ ✦ 1× compiled() in src/lib/docs.compiled.ts

  2 calls inlined across 2 modules
```

<Callout type="warning">

A compiled function is re-evaluated when the file containing it is recompiled, but files it _reads_ at runtime are not tracked. If the function reads from disk, edits to those files will not refresh the value until the containing module changes. Restart the dev server when in doubt.

</Callout>

<Callout type="danger">

The value is inlined wherever the call appears. Inside a `mochi:hydrate` island it is therefore sent to the browser, so never return a secret from a `compiled()` call in a hydrated component.

</Callout>
