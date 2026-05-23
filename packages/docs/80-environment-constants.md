---
title: 'Environment constants'
slug: environment-constants
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Environment constants

Import build-time constants from the `mochi-framework` virtual module to branch on render target or dev mode:

```ts
import { isServer, isBrowser, isDev } from 'mochi-framework';
```

`mochi-framework` resolves to one of two virtual modules at compile time — server builds export `isServer = true`, client bundles export `isBrowser = true`. The values are literal booleans, so `if (isBrowser) { … }` blocks dead-code-eliminate out of the opposite bundle.

Do **NOT** read `process.env.NODE_ENV` or `typeof window` to detect environment; instead, import these constants — they survive bundling intact.

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

## Auto-injected island props

The preprocessor injects two extra props on every component invoked with `mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer mochi:hydrate`:

- `islandId` (`string`): stable id matching the wrapping `<mochi-hydratable-island island-id>` attribute.
- `isHydratable` (`true | undefined`): `true` for hydratable invocations, absent on plain SSR-only invocations.

Accept them with `$props`:

```svelte
<!-- file: src/lib/Counter.svelte -->
<script>
  let { islandId, isHydratable } = $props<{ islandId?: string; isHydratable?: boolean }>();
</script>
```

### Branching SSR-only behavior with `isHydratable`

Use `isHydratable` to peek request-scoped state only when the client won't take over rendering — e.g. read the post-submit form snapshot so the SSR HTML reflects the last action result, but skip it when an `enhance` attachment will populate state client-side.

```svelte
<!-- file: src/lib/RandomRoll.svelte -->
<script>
  import { isServer, getRequestContext } from 'mochi-framework';

  let { isHydratable } = $props<{ isHydratable?: boolean }>();

  const initial = isHydratable || !isServer ? null : peekForm();

  function peekForm() {
    const f = getRequestContext().form;
    return f && f.ok && typeof f.data.value === 'number' ? f.data.value : null;
  }
</script>
```

See the [Forms demo](/demos/login/) for a side-by-side comparison of hydrated and SSR-only render paths.
