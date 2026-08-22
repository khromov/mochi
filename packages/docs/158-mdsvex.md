---
title: 'MdSvex'
slug: mdsvex
ogTitle: 'Markdown pages with MdSvex'
description: 'Enable Markdown support in Mochi pages with mdsvex and rehype/remark plugins.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
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
import About from './about.md';

await Mochi.serve({
  markdown: {
    compile: mdsvexCompile,
    rehypePlugins: [rehypeSlug],
  },
  routes: {
    '/about': Mochi.page(About),
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

### Syntax highlighting

Fenced code blocks pass through unchanged unless you supply `markdown.highlight.highlighter`. Install a highlighting engine (Shiki, highlight.js, Prism) and build a highlighter with the framework's `createHighlighter` factory. It adds the code-block wrapper, copy button, and Svelte-brace escape.

```sh
bun add shiki
```

```ts
// src/lib/highlightCode.ts
import { createHighlighter as createShiki, createJavaScriptRegexEngine } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';

const shiki = await createShiki({
  engine: createJavaScriptRegexEngine({ forgiving: true }),
  themes: ['vitesse-dark'],
  langs: ['typescript', 'bash'],
});

export const highlightCode = createHighlighter((code, lang) => shiki.codeToHtml(code, { lang, theme: 'vitesse-dark' }));
```

Mochi memoizes results per `(code, lang)`. The cache holds 1000 snippets and evicts in insertion order. Tune it with `cacheSize` (`0` disables memoization).

`createJavaScriptRegexEngine` uses the JS `RegExp` engine, so no WASM is loaded — Shiki's default oniguruma WASM engine grows `WebAssembly.Memory` that is never reclaimed.

<Callout type="info">

The JS `RegExp` engine can hang on Windows. Gate it behind `process.platform !== 'win32'` and fall back to the WASM default there.

</Callout>

```ts
// src/index.ts
import { highlightCode } from './lib/highlightCode';

markdown: {
  compile: mdsvexCompile,
  highlight: { highlighter: (code, lang) => highlightCode(code, lang) },
}
```

`createHighlighter` accepts any `(code, lang) => string | Promise<string>` function.

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

<SeeItInAction
demos={[{ href: "/demos/mdsvex/", title: "MdSvex", hook: "A .md file compiled through mdsvex and rendered as a Svelte component." }]}
/>
