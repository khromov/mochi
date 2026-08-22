---
title: 'Environment constants'
slug: environment-constants
description: 'Build-time constants for branching on render target (isServer, isBrowser), dev mode (isDev), and the build itself (isBuilding).'
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

### `isBuilding`

`true` only while `mochi-framework build` runs your `index.ts`, `false` when serving (dev or prod). `mochi-framework build` executes your entry to capture its `Mochi.serve()` options, so top-level side effects in `index.ts` run at build time too. Gate the ones you don't want then — connecting a database, spawning workers, running migrations:

```ts
// file: src/index.ts
import { Mochi, isBuilding } from 'mochi-framework';

if (!isBuilding) await db.connect();

await Mochi.serve({ routes });
```

The dev server re-imports `index.ts` on every rebuild to pick up route changes; that import sees `true` too, so gated side effects don't re-run on each save.

Inside `.svelte` components it is always `false` — components are compiled but never executed during a build.

## Detecting hydration with `isHydratable()`

To branch on whether the client will take over rendering, use `isHydratable()`: it returns `true` when the calling component — at any nesting depth — belongs to a subtree that will hydrate on this page load. Unlike the constants above it is a runtime signal, not a build-time literal, so it lives with the hydration model rather than here. See [Selective hydration](/docs/selective-hydration/#ishydratable) for the full semantics and an example.

<SeeItInAction
demos={[{ href: "/demos/url/", title: "Isomorphic URL", hook: "How the isomorphic URL helper works — one import that reads the request URL on the server and window.location on the client." }]}
/>
