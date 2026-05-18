<script>
  let { name = 'world' } = $props();
  const renderedAt = new Date().toISOString();
</script>

## Hello, {name}!

This block was authored in **Markdown** but compiled into a Svelte component
via [`mdsvex`](https://mdsvex.pngwn.io/), so prose, _emphasis_, `inline code`,
and a normal Svelte `<script>` block all coexist.

Headings get `id` attributes via `rehype-slug`, so this section is linkable as
`#hello-name`. The page was rendered at:

> {renderedAt}
