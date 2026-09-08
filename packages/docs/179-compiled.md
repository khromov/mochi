---
title: 'Build-time modules'
slug: compiled
description: 'Name a module *.compiled.ts to run it at build time and inline its exports, so the code that produced them never ships.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Build-time modules

<VersionNote since="0.10.0" message="*.compiled.ts modules and moduleRef() are not in the published release yet. This page describes the upcoming API." />

A module named `*.compiled.ts` (or `.compiled.js`) runs while your app compiles. The bundler replaces it with its exported values, so the module, and everything it imports, is left out of the bundle.

```ts
// src/demos/url/sources.compiled.ts
import { loadSources } from '../../components/utils.ts';
import { files } from './files.ts';

export const sources = await loadSources(files);
```

```svelte
<script>
  import { sources } from './sources.compiled.ts';
</script>
```

What the bundle holds is the finished value, not the code:

```js
const __mochi_export_0__ = [{ label: 'App.svelte', html: '<pre>…</pre>' }];
export { __mochi_export_0__ as sources };
```

`loadSources` and `files` are gone, and so is anything they imported — which is the point: a syntax highlighter, a markdown parser, or a database client used only to produce the value stops being a runtime dependency.

The suffix is the whole convention, like [`.server.ts`](/docs/server-only-imports/). Top-level `await` works; the build awaits it. Import the module with the extension (`./sources.compiled.ts`) from a `.svelte` or `.md` file, or from a `.ts` module one of them imports. Only the component bundler replaces it: imported from the server entry (`routes.ts`, an API handler), it runs as a plain module, and `moduleRef()` throws.

### What a build-time module may export

Anything [devalue](https://github.com/sveltejs/devalue) can serialize: plain data, `Date`, `Map`, `Set`, `RegExp`, `BigInt`, `undefined`, cycles, and repeated references. Functions, class instances, and promises are a compile error naming the export:

```
src/lib/table.compiled.ts exports "rows", which cannot be inlined: Cannot stringify a function at rows[0].format.
```

Each export is serialized on its own, so an object shared between two exports is inlined twice.

### Returning components with `moduleRef()`

A component cannot be serialized. `moduleRef()` marks a module to import instead, and the build turns each marker into a real `import`:

```ts
// src/lib/docComponents.compiled.ts
import { moduleRef } from 'mochi-framework';
import type { Component } from 'svelte';
import { loadDocs } from './docs';

export const docComponents: Record<string, Component> = Object.fromEntries((await loadDocs()).map((d) => [d.slug, moduleRef<Component>(`../../docs/${d.filename}`)]));
```

becomes:

```js
import __mochi_ref_0__ from '../../docs/10-intro.md';
const __mochi_export_0__ = { intro: __mochi_ref_0__ };
export { __mochi_export_0__ as docComponents };
```

Specifiers resolve relative to the `.compiled.ts` file. This replaces generating a barrel file into your source tree before every build, and the map stays typed against the real module.

A build-time module cannot `import` a `.svelte`, `.md`, or `.svelte.ts` file itself — it runs outside the bundler, where Svelte files have no loader. The build rejects the import and points at `moduleRef()`.

### In dev

The module is evaluated at build time in dev too, and re-evaluated on every rebuild. An edit to the module or to anything it imports rebuilds the pages that use it. A file it only _reads_ — a directory of markdown, say — is outside the import graph: adding or removing a source or data file (`.md`, `.svelte`, `.ts`, `.json`, …) rebuilds every build-time module, while an edit to one shows up on the next rebuild of a page that imports the module.

<Callout type="warning">

Each dev evaluation gets fresh instances of the module's own imports, but the running server keeps its own. A memo that must be shared between the two, say a parsed-docs cache the build-time module fills and a route reads, has to live on `globalThis` — use `pinGlobal(key, create)` from `mochi-framework`.

</Callout>

### What the build reports

`mochi-framework build` prints every module it inlined:

```
      Build-time modules
  ┌ ✦ src/demos/url/sources.compiled.ts
  └ ✦ src/lib/docComponents.compiled.ts

  2 build-time modules inlined
```

<Callout type="danger">

The value is inlined wherever the module is imported. Inside a `mochi:hydrate` island it is therefore sent to the browser, so never export a secret from a build-time module a hydrated component imports.

</Callout>
