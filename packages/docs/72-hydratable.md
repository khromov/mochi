---
title: 'Hydratable values'
slug: hydratable
description: 'Serialize computed server values into the page so the client can reuse them without re-running the work.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Hydratable values (experimental)

> hydratable support is experimental, please create an issue if you find problems! 🙇

Svelte 5's [`hydratable(key, fn)`](https://svelte.dev/docs/svelte/svelte#hydratable) computes a value on the server, serializes it into `<head>`, and reads it back during client hydration instead of recomputing. Use it to avoid running the same async work twice when a hydrated component does data fetching at the top level.

Without it, the function runs once on the server and again during hydration:

```svelte
<script>
  import { getUser } from 'my-database-library';

  // Runs on the server AND again on the client during hydration.
  const user = await getUser();
</script>

<h1>{user.name}</h1>
```

With it, the server result is reused on the client:

```svelte
<script>
  import { hydratable } from 'svelte';
  import { getUser } from 'my-database-library';

  // SSR: runs `getUser`, devalue-serializes the result into <head>.
  // Client: reads the value from window.__svelte.h, never invokes `getUser`.
  const user = await hydratable('app:user', () => getUser());
</script>

<h1>{user.name}</h1>
```

Mochi already wires this up: any `hydratable()` call inside a `Mochi.page(...)` route or a `mochi:hydrate*` island is collected into the page's head script during SSR and picked up by Svelte's `hydrate()` automatically. There's no extra Mochi-side import — `hydratable` comes straight from `svelte`.

See it in action in the [Hydratable demo](/demos/hydratable/), where the page and a hydrated island share the same key — the server function runs once, both sides render the same value, and the island skips the async work on hydration.

<Callout type="info">

**Namespace your keys.** Hydratable keys are global per-render. Prefix every key with your app or library name (`app:user`, `mylib:cart`) so two unrelated callers can't collide.

</Callout>

### Serialization

Values are serialized with [`devalue`](https://www.npmjs.com/package/devalue), so `Map`, `Set`, `Date`, `URL`, `BigInt`, and circular references all round-trip. Promises also work — Svelte stitches them back together on the client.

### Limitations in Mochi today

<Callout type="warning">

**Server islands.** `mochi:defer` server islands render in a separate request, and their `<head>` output is not merged into the parent page. `hydratable()` calls inside a server island won't reach `window.__svelte.h` — keep them in the page or in eagerly hydrated islands for now.

**No CSP nonce wiring.** Mochi does not yet pass a `csp.nonce` through to Svelte's `render()`, so the inline lookup script will be blocked under strict `script-src` policies. Either allow `'unsafe-inline'` for scripts (which you likely already do for the island bootstrap) or wait for nonce plumbing.

</Callout>

<SeeItInAction
demos={[{ href: "/demos/hydratable/", title: "Hydratable", hook: "How hydratable() works — compute a value once on the server and reuse it on the client instead of re-running async work during hydration." }]}
/>
