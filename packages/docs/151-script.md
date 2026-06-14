---
title: 'Script'
slug: script
description: 'Bundle and load a client-side script through dynamic import(), addressed by a path relative to the component.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Script

<Callout type="warning">

**Experimental.** This API is new and may change in a future release.

</Callout>

`<Script />` loads a client-side script with a dynamic `import()`. The path you give it is bundled at **build time** through Mochi's own `Bun.build()` — TypeScript is transpiled, imports are resolved, the output is content-hashed and code-split — and the runtime `import()` points at that bundled URL. It never fetches or transpiles your source at runtime.

```svelte
<script>
  import { Script } from 'mochi-framework/components';
</script>

<Script src="./analytics.ts" />
```

The `src` is resolved relative to **the `.svelte` file that renders it** (absolute paths work too). Reach for it when you have a loose client script — analytics, a web-component registration, a third-party widget bootstrap — that should ship to the browser but isn't an island.

Load several at once with `scripts`:

```svelte
<Script scripts={['./a.ts', './b.ts']} />
```

<Callout type="info">

`src` / `scripts` must be **static string literals** — they're read at build time so the files can become bundle entrypoints. A dynamic path (`src={someVar}`) throws at compile time, as does a path that doesn't resolve to a file on disk. The build fails loudly rather than shipping a broken `import()`.

</Callout>

<Callout type="warning">

`<Script />` is **SSR-only** — it emits a module script that loads its own bundle. Don't put it inside a hydrated island (`mochi:hydrate*` / `mochi:defer*`); it throws if hydrated.

</Callout>

<Callout type="info">

`eslint-plugin-svelte` treats the capitalized `<Script>` tag as the HTML `<script>` element rather than a component reference, so it may flag the import as unused (`no-unused-vars`). Alias it (`import { Script as ScriptTag }`) or add an `eslint-disable-next-line` above the import — the component itself compiles correctly.

</Callout>

### How it differs from `RawScript`

[`RawScript`](/raw-script) inlines a file's bytes verbatim with no build step, addressed from the working directory. `Script` bundles its target through `Bun.build()` and loads it with `import()`, addressed relative to the component. Use `RawScript` for pre-authored inline blobs; use `Script` when the source needs transpiling or has imports of its own.
