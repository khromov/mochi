---
title: 'MdSvex'
slug: mdsvex
ogTitle: 'Markdown pages with MdSvex'
description: 'Enable Markdown support in Mochi pages with mdsvex and rehype/remark plugins.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## MdSvex

<Callout type="warning">

Experimental — `markdown` and `mochi-framework/highlight` APIs may change.

</Callout>

Markdown support is opt-in. Install `mdsvex` and any rehype/remark plugins you want, then inject them through `Mochi.serve({ markdown: ... })`.

```sh
bun add mdsvex@^0.12 rehype-slug@^6
```

Mochi is tested against `mdsvex ^0.12` and `rehype-slug ^6`.

With `markdown` configured, `.md` and `.svx` files compile through the pipeline and can be used anywhere a `.svelte` component is accepted, including as a `Mochi.page()` route target:

```ts
// src/index.ts
import { Mochi } from 'mochi-framework';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';

await Mochi.serve({
  markdown: {
    compile: mdsvexCompile,
    rehypePlugins: [rehypeSlug],
  },
  routes: {
    '/about': Mochi.page('./src/about.md'),
  },
});
```

Markdown can embed Svelte syntax — a top-level `<script>` block, `$props`, and `{expression}` interpolation work as in a `.svelte` file:

```svelte
<script>
  let { name = 'world' } = $props();
</script>

# Hello, {name}

This page was rendered at {new Date().toISOString()}.
```

The `markdown` config accepts a full plugin chain compatible with mdsvex's `rehypePlugins` and `remarkPlugins`.

### Syntax highlighting with Shiki or twinkleplop

Fenced code blocks pass through unchanged unless you supply `markdown.highlight.highlighter`. Install a highlighting engine (twinkleplop, Shiki, highlight.js, Prism) and build a highlighter with the framework's `createHighlighter` factory. It adds the code-block wrapper, copy button, Svelte-brace escape, and memoization per `(code, lang)`.

This site uses twinkleplop, which ships one package per language and highlights synchronously:

```sh
bun add @twinkleplop/typescript @twinkleplop/bash
```

```ts
// src/lib/highlightCode.ts
import { language as bash } from '@twinkleplop/bash';
import { language as typescript } from '@twinkleplop/typescript';
import { createHighlighter } from 'mochi-framework/highlight';

const grammars: Record<string, (code: string) => string> = {
  bash: bash(),
  typescript: typescript(),
};

export const highlightCode = createHighlighter((code, lang) => (grammars[lang] ?? grammars.typescript)(code));
```

```ts
// src/index.ts
import { highlightCode } from './lib/highlightCode';

markdown: {
  compile: mdsvexCompile,
  highlight: { highlighter: (code, lang) => highlightCode(code, lang) },
}
```

The cache holds 1000 snippets and evicts in insertion order. Tune it with `cacheSize` (`0` disables memoization).

<Callout type="info">

twinkleplop has no alias table, so the `lang` mdsvex hands you is the raw fence word — map `ts`, `js`, `sh`, `yml` and friends onto your grammar keys yourself, and decide what an unknown language does. `escapeHtmlAttr` from `mochi-framework` renders one unhighlighted without throwing.

</Callout>

Any other engine drops in the same way, sync or async:

```ts
import hljs from 'highlight.js';
import { createHighlighter } from 'mochi-framework/highlight';

export const highlightCode = createHighlighter((code, lang) => hljs.highlight(code, { language: lang }).value);
```

#### Theming

twinkleplop emits token classes rather than inline colours, so the theme is a stylesheet you supply:

```html
<pre class="twinkleplop"><code><span class="l"><span class="tok keyword">const</span> …</span></code></pre>
```

Import a ready-made one (`import '@twinkleplop/theme-github'`), or write the rules yourself against the token names the theme packages export from their `/tokens` subpath:

```css
.twinkleplop .tok.keyword {
  color: #a7c9a8;
}
.twinkleplop .tok.string {
  color: #d5b982;
}
```

Engines that inline their own colours (Shiki, highlight.js themes) need no stylesheet of yours.

### Islands in markdown

`mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, and `mochi:defer:visible` work on components instantiated inside a `.md` / `.svx` file. Import the component as a default import from the markdown's top-level `<script>` block, then apply the directive on the tag:

```svelte
<script>
  import Counter from './Counter.svelte';
</script>

<Counter mochi:hydrate count={3} />
```

<Callout type="info">

Omitting the `markdown` config disables `.md`/`.svx` handling, so importing one surfaces a "no loader" error from Bun's bundler. Your `svelte.config.js` `compilerOptions` still apply to compiled markdown. See [Svelte config](/docs/svelte-config/).

</Callout>

### Mapping slugs to markdown components

<VersionNote since="0.10.0" message="*.prerender.ts modules and moduleRef() are not in the published release yet." />

A docs or blog section usually needs every `.md` file keyed by slug. Build that map in a [prerendered module](/docs/prerender/) instead of generating a barrel file into your source tree:

```ts
// src/lib/docs.prerender.ts
import { moduleRef } from 'mochi-framework';
import type { Component } from 'svelte';
import { loadDocs } from './docs';

export const docs: Record<string, Component> = Object.fromEntries((await loadDocs()).map((d) => [d.slug, moduleRef<Component>(`../../docs/${d.filename}`)]));
```

Each `moduleRef()` becomes a real `import` of the `.md` file, so the markdown still compiles through the pipeline above.

<SeeItInAction
demos={[{ href: "/demos/mdsvex/", title: "MdSvex", hook: "A .md file compiled through mdsvex and rendered as a Svelte component." }]}
/>
