---
title: 'Welcome'
slug: intro
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

# mochi

Mochi is an SSR framework for [Svelte 5](https://svelte.dev/) on [Bun](https://bun.sh/). Components render server-side on every request; only components specifically opted into hydration ship JavaScript to the browser. The rest stay as SSR-rendered, performant HTML with full support for Svelte features such as scoped CSS.

<Callout type="info">

**Mochi is in early development** Only use in production if you are brave.

</Callout>

Mochi is _not_ as a drop-in SvelteKit replacement; instead, expect a smaller and leaner framework with opt-in hydration.s
