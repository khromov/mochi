---
title: 'RawScript'
slug: raw-script
description: 'Inline the raw contents of a file into the page at SSR time, addressed by a working-directory-relative path.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## RawScript

`<RawScript />` reads a file at SSR time and prints its contents verbatim with `{@html}`. The `src` is resolved relative to the **working directory** — the same convention as the paths you pass to `Mochi.page('./src/...')`:

```svelte
<script>
  import { RawScript } from 'mochi-framework/components';
</script>

<script type="speculationrules">
  <RawScript src="./src/inline/rules.json" />
</script>
```

Reach for it when you have a chunk of pre-authored JS, JSON, or CSS on disk that you want inlined into the document — an inline `<script>`, speculation rules, a critical-CSS blob — without a build step or a fetch.

```svelte
<RawScript src="./src/inline/snippet.js" />
<!-- relative to the working dir -->
<RawScript src={absolutePath} />
<!-- absolute paths work too -->
```

<Callout type="info">

`src` is **not** relative to the component that renders it. By the time a component runs it has been compiled and bundled into `.mochi/`, so its original source location no longer exists — there's no reliable way to recover it at runtime. Address files from the working directory instead, exactly like route paths.

</Callout>

<Callout type="warning">

`<RawScript />` is **SSR-only** — it reads from disk, which the browser can't do. Don't put it inside a hydrated island (`mochi:hydrate*` / `mochi:defer*`); it throws if hydrated. It also does no escaping — the file content is emitted raw, so only point it at files you author.

</Callout>
