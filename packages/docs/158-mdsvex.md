---
title: 'MdSvex'
slug: mdsvex
description: 'Enable Markdown support in Mochi pages with mdsvex and rehype/remark plugins.'
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
`markdown.highlight.highlighter`. Install a highlighting engine (Shiki,
highlight.js, Prism, etc.) and build a highlighter with the framework's
`createHighlighter` factory — it adds the code-block wrapper, copy button,
and Svelte-brace escape around the engine's output.

```sh
bun add shiki
```

```ts
// src/lib/highlightCode.ts
import { createHighlighter as createShiki } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';

const shiki = await createShiki({
  themes: ['vitesse-dark'],
  langs: ['typescript', 'bash'],
});

export const highlightCode = createHighlighter((code, lang) => shiki.codeToHtml(code, { lang, theme: 'vitesse-dark' }));
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

`createHighlighter` accepts any `(code, lang) => string | Promise<string>`
function, so you can plug in highlight.js, Prism, or a custom engine the
same way.

### Islands in markdown

`mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, and `mochi:defer:visible` all work on
components instantiated inside a `.md` / `.svx` file. Import the component
as a default import from the markdown's top-level `<script>` block, then
apply the directive on the tag:

```svelte
<script>
  import Counter from './Counter.svelte';
</script>

<Counter mochi:hydrate count={3} />
```

<Callout type="info">
Omitting the `markdown` config disables `.md`/`.svx` handling entirely —
importing one then surfaces as a "no loader" error from Bun's bundler. Your
`svelte.config.js` `compilerOptions` still apply to compiled markdown. See
[Svelte config](/docs/svelte-config/).
</Callout>
