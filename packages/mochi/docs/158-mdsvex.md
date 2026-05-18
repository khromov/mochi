---
title: 'MdSvex'
slug: mdsvex
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## MdSvex

<Callout type="warning">

Experimental — `markdown` and `mochi-framework/highlight` APIs may change.

</Callout>

Markdown support is opt-in. Install `mdsvex` and any rehype/remark plugins you
want, then inject them through `Mochi.serve({ markdown: ... })`.

```sh
bun add mdsvex@^0.12 rehype-slug@^6
```

Mochi is tested against `mdsvex ^0.12` and `rehype-slug ^6`. Other rehype/remark
plugins follow their own version ranges — install whichever your pipeline needs.

```ts
// src/index.ts
import { Mochi } from 'mochi-framework';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import { routes } from './routes';

await Mochi.serve({
  markdown: {
    compile: mdsvexCompile,
    rehypePlugins: [rehypeSlug],
  },
  routes,
});
```

With `markdown` configured, `.md` and `.svx` files compile through the supplied
pipeline and can be used anywhere a `.svelte` component is accepted — including
as a `Mochi.page()` route target:

```ts
// src/routes.ts
import { Mochi } from 'mochi-framework';

export const routes = {
  '/about': Mochi.page('./src/about.md'),
};
```

Markdown can embed Svelte syntax — a top-level `<script>` block, `$props`, and
`{expression}` interpolation all work the same as in a `.svelte` file:

```svelte
<script>
  let { name = 'world' } = $props();
</script>

# Hello, {name}

This page was rendered at {new Date().toISOString()}.
```

The `markdown` config accepts a full plugin chain — anything compatible with
mdsvex's `rehypePlugins` and `remarkPlugins` works:

```ts
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

markdown: {
  compile: mdsvexCompile,
  rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
  remarkPlugins: [],
}
```

### Syntax highlighting

Fenced code blocks are passed through unchanged unless you supply
`markdown.highlight.highlighter`. Install `highlight.js` (or any other
engine), register the languages you need, and build a highlighter with the
framework's `createHighlighter` factory — it adds the code-block wrapper,
copy button, and Svelte-brace escape around the engine's output.

```sh
bun add highlight.js@^11
```

```ts
// src/lib/highlightCode.ts
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import { createHighlighter } from 'mochi-framework/highlight';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);

export const highlightCode = createHighlighter(hljs);
```

```ts
// src/index.ts
import { highlightCode } from './lib/highlightCode';

markdown: {
  compile: mdsvexCompile,
  highlight: { highlighter: (code, lang) => highlightCode(code, lang) },
}
```

`highlightCode` is also usable directly in pages and components for
snippets outside the markdown pipeline.

For a different engine (shiki, prism), skip `createHighlighter` and pass
your own `(code, lang) => string` straight into `markdown.highlight`.

<Callout type="warning">
A `.md` file is rendered SSR-only — `mochi:hydrate` directives inside markdown
are not preprocessed and won't create islands. For interactivity, render the
markdown from a `.svelte` page that wraps the parts you want hydrated, or use
a `.svelte` route and import the `.md` content as a child component.
</Callout>

<Callout type="info">
Omitting the `markdown` config disables `.md`/`.svx` handling entirely —
importing one then surfaces as a "no loader" error from Bun's bundler. Your
`svelte.config.js` `compilerOptions` still apply to compiled markdown. See
[Svelte config](/docs/svelte-config/).
</Callout>
