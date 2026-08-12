---
title: 'RawScript'
slug: raw-script
ogTitle: 'Inlining a file at SSR time with RawScript'
description: 'Inline the raw contents of a file into the page at SSR time, addressed by a working-directory-relative path.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## RawScript

<Callout type="warning">

**Experimental.** This API is new and may change in a future release.

</Callout>

`<RawScript />` reads a file at SSR time and prints its contents verbatim with `{@html}`. Mochi resolves `src` relative to the **working directory** — the same convention as the paths you pass to `Mochi.page('./src/...')`.

```svelte
<script>
  import { RawScript } from 'mochi-framework/components';
</script>

<script type="speculationrules">
  <RawScript src="./src/inline/rules.json" />
</script>
```

Use it when you have a chunk of pre-authored JavaScript, JSON, or CSS on disk that you want inlined into the document — an inline `<script>`, speculation rules, or a critical-CSS blob — without a build step or a fetch.

To inline content you already have as a string, pass `string`. Provide exactly one of `src` or `string`. Passing both, or neither, throws.

```svelte
<RawScript string={`window.__BUILD__ = ${JSON.stringify(buildInfo)};`} />
```

<Callout type="info">

`src` is **not** relative to the component that renders it. By the time a component runs, it is compiled and bundled into `.mochi/`, so its original source location no longer exists. Address files from the working directory, like route paths.

</Callout>

<Callout type="warning">

`<RawScript />` is **SSR-only** — it reads from disk, which the browser cannot do. Do not put it inside a hydrated island. It throws if hydrated. It does no escaping, so point it only at files you author.

</Callout>
