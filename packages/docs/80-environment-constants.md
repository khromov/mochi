---
title: 'Environment constants'
slug: environment-constants
description: 'Build-time constants for branching on render target (isServer, isBrowser) and dev mode (isDev).'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Environment constants

Import build-time constants from `mochi-framework` to branch on render target or dev mode:

```ts
import { isServer, isBrowser, isDev } from 'mochi-framework';
```

At build time these constants become literal booleans. In the server build `isServer` is `true` and `isBrowser` is `false`. In the client bundle the values are reversed. Because they are literals, an `if (isBrowser) { … }` block is dropped from the opposite bundle, so a server-only branch never reaches the browser.

### `isServer`

`true` during server-side rendering, `false` in the browser.

```svelte
<!-- file: src/lib/HeavyChart.svelte -->
<script>
  import { isServer } from 'mochi-framework';

  if (isServer) {
    // reach into request-scoped APIs here
  }
</script>
```

### `isBrowser`

`true` in the client bundle, `false` on the server. Use it to gate browser-only APIs (`window`, `document`, `IntersectionObserver`).

```svelte
<!-- file: src/lib/Lazy.svelte -->
<script>
  import { isBrowser } from 'mochi-framework';

  if (isBrowser) {
    window.addEventListener('scroll', onScroll);
  }
</script>
```

### `isDev`

`true` when `Mochi.serve()` started with `development: true`. Identical on server and client builds.

```ts
// file: src/lib/log.ts
import { isDev } from 'mochi-framework';

export function trace(msg: string) {
  if (isDev) console.log('[trace]', msg);
}
```

## Detecting hydration with `isHydratable()`

`isHydratable()` returns `true` when the calling component — at any nesting depth — belongs to a subtree that will hydrate on this page load. See [Selective hydration](/docs/selective-hydration/#ishydratable) for the full semantics.

For a unique per-instance id (for example, `<label for>`), use Svelte's native `$props.id()`.

### Branching SSR-only behavior

Use `isHydratable()` to do work only when the client won't take over rendering. A component that renders both as a hydrated island and as a plain SSR-only child can prepare a server-rendered fallback in the SSR-only case and skip it when the island will hydrate:

```svelte
<!-- file: src/lib/LiveCount.svelte -->
<script lang="ts">
  import { isHydratable } from 'mochi-framework';

  let { count }: { count: number } = $props();

  // The hydrated island renders a live control; plain SSR gets a static snapshot.
  const interactive = isHydratable();
</script>

{#if interactive}
  <button>{count}</button>
{:else}
  <span>{count}</span>
{/if}
```

<SeeItInAction
demos={[{ href: "/demos/url/", title: "Isomorphic URL", hook: "How the isomorphic URL helper works — one import that reads the request URL on the server and window.location on the client." }]}
/>
