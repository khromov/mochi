---
title: 'Environment constants'
slug: environment-constants
description: 'Build-time constants for branching on render target (isServer, isBrowser) and development mode (isDev).'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Environment constants

Import build-time constants from the `mochi-framework` virtual module to branch on render target or dev mode:

```ts
import { isServer, isBrowser, isDev } from 'mochi-framework';
```

`mochi-framework` resolves to one of two virtual modules at compile time — server builds export `isServer = true`, client bundles export `isBrowser = true`. The values are literal booleans, so `if (isBrowser) { … }` blocks dead-code-eliminate out of the opposite bundle.

### `isServer`

`true` during server-side rendering, `false` in the browser.

```svelte
<!-- file: src/lib/HeavyChart.svelte -->
<script>
  import { isServer } from 'mochi-framework';

  if (isServer) {
    // safe to reach into request-scoped APIs here
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

`true` when `Mochi.serve()` was started with `development: true`. Identical on server and client builds.

```ts
// file: src/lib/log.ts
import { isDev } from 'mochi-framework';

export function trace(msg: string) {
  if (isDev) console.log('[trace]', msg);
}
```

## `isHydratable()`

`isHydratable()` returns `true` when the calling component is anywhere inside a hydrated island subtree — during **both** the SSR pass and the client hydration pass — and `false` for plain SSR-only components. Because it reads a Svelte context seeded once at the island boundary, it propagates to descendants at any depth, not just the directive-bearing tag.

Call it at component init (top of `<script>`), like Svelte's own `getContext`:

```svelte
<!-- file: src/lib/Counter.svelte -->
<script lang="ts">
  import { isHydratable } from 'mochi-framework';

  const hydrating = isHydratable();
</script>
```

For a unique per-instance id (e.g. `<label for>`), use Svelte's native `$props.id()` — see [Selective hydration](/docs/selective-hydration/).

### Branching SSR-only behavior with `isHydratable()`

Use `isHydratable()` to peek request-scoped state only when the client won't take over rendering — e.g. read the post-submit form snapshot so the SSR HTML reflects the last action result, but skip it when an `enhance` attachment will populate state client-side.

```svelte
<!-- file: src/lib/RandomRoll.svelte -->
<script lang="ts">
  import { isServer, isHydratable, getRequestContext } from 'mochi-framework';

  const initial = isHydratable() || !isServer ? null : peekForm();

  function peekForm() {
    const f = getRequestContext().form;
    return f && f.ok && typeof f.data.value === 'number' ? f.data.value : null;
  }
</script>
```

See the [Forms demo](/demos/login/) for a side-by-side comparison of hydrated and SSR-only render paths.

<SeeItInAction
demos={[{ href: "/demos/url/", title: "Isomorphic URL", hook: "One import for the current URL — reads from the request on the server, window.location on the client." }]}
/>
