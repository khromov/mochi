---
title: 'Lazy hydration with mochi:hydrate:visible'
slug: lazy-hydration
description: 'Defer island hydration until the component scrolls into view with mochi:hydrate:visible.'
---

## Lazy hydration with `mochi:hydrate:visible`

Defer hydration until a component scrolls into the viewport. The component still renders server-side on every request, but its JavaScript and CSS are fetched only when the wrapper intersects the viewport via `IntersectionObserver`.

```svelte
<!-- file: src/Page.svelte -->
<HeavyChart mochi:hydrate:visible />
```

Pass an options object to start loading before the element enters the viewport. `rootMargin` is forwarded straight to `IntersectionObserver`:

```svelte
<HeavyChart mochi:hydrate:visible={{ rootMargin: '200px' }} />
```

The default `rootMargin` is `'0px'` — hydration fires the moment the island's first child crosses the viewport edge. Once intersection fires the observer disconnects, the component bundle imports, the deferred CSS link is appended to `<head>`, and Svelte hydrates the existing SSR markup.

### Combining with `mochi:defer`

Stack `mochi:defer mochi:hydrate:visible` to defer both rendering and hydration: the placeholder ships with the page, the SSR HTML streams in when the deferred fetch resolves, and the JavaScript loads only after the now-rendered island scrolls into view.

```svelte
<Comments mochi:defer mochi:hydrate:visible={{ rootMargin: '300px' }} />
```

See `Selective hydration` for the eager `mochi:hydrate` directive and `Server islands` for `mochi:defer` on its own.
