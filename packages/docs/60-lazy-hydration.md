---
title: 'Lazy hydration with mochi:hydrate:visible'
slug: lazy-hydration
description: 'Defer island hydration until the component scrolls into view with mochi:hydrate:visible.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Lazy hydration with `mochi:hydrate:visible`

Defer hydration until a component scrolls into the viewport. The component still renders on the server on every request. Its JavaScript and CSS are fetched only when the wrapper intersects the viewport.

```svelte
<!-- file: src/Page.svelte -->
<HeavyChart mochi:hydrate:visible />
```

Pass an options object to start loading before the element enters the viewport. Mochi forwards `rootMargin` straight to `IntersectionObserver`.

```svelte
<HeavyChart mochi:hydrate:visible={{ rootMargin: '200px' }} />
```

The default `rootMargin` is `'0px'` — hydration fires the moment the island's first child crosses the viewport edge. On intersection the observer disconnects, the bundle imports, the deferred CSS link appends to `<head>`, and Svelte hydrates the SSR markup.

<Callout type="info">

**A lazy island's CSS loads lazily too.** Mochi fetches the stylesheet with the JavaScript on intersection, so the island can briefly render unstyled. Put critical above-the-fold styles in the page shell, or use `mochi:hydrate` for anything that must look right before it scrolls into view.

</Callout>

### Combining with `mochi:defer`

Stack `mochi:defer mochi:hydrate:visible` to defer both rendering and hydration. The placeholder ships with the page. The SSR HTML streams in when the deferred fetch resolves. The JavaScript loads only after the rendered island scrolls into view.

```svelte
<Comments mochi:defer mochi:hydrate:visible={{ rootMargin: '300px' }} />
```

See [Selective hydration](/docs/selective-hydration/) for `mochi:hydrate` and [Server islands](/docs/server-islands/) for `mochi:defer`.

<SeeItInAction
demos={[
{ href: "/demos/lazy/", title: "Lazy Islands", hook: "mochi:hydrate:visible islands hydrate and load CSS only when scrolled into view." },
{ href: "/demos/lazy-server-island/", title: "Lazy Server Islands", hook: "mochi:defer:visible islands fetch only when the wrapper scrolls into view." },
]}
/>
