---
title: 'Hydratable values'
slug: hydratable
description: 'Serialize computed server values into the page so the client reuses them instead of re-running the work.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Hydratable values (experimental)

> `hydratable` support is experimental. Please open an issue if you find problems. 🙇

Svelte 5's [`hydratable(key, fn)`](https://svelte.dev/docs/svelte/svelte#hydratable) computes a value on the server, serializes it into the page, and reads it back during client hydration. Use it to avoid running the same async work twice when a hydrated component fetches data at the top level.

Without it, the function runs on the server and again during hydration:

```svelte
<script>
  import { getUser } from 'my-database-library';

  // Runs on the server AND again on the client during hydration.
  const user = await getUser();
</script>

<h1>{user.name}</h1>
```

With it, the client reuses the server result:

```svelte
<script>
  import { hydratable } from 'svelte';
  import { getUser } from 'my-database-library';

  // SSR: runs getUser and serializes the result into the page.
  // Client: reads the serialized value and skips getUser.
  const user = await hydratable('app:user', () => getUser());
</script>

<h1>{user.name}</h1>
```

Mochi wires this up. Any `hydratable()` call inside a `Mochi.page(...)` route or a `mochi:hydrate*` island is collected during SSR and picked up by Svelte's `hydrate()` automatically. Import `hydratable` straight from `svelte`.

<Callout type="info">

**Namespace your keys.** Hydratable keys are global per render. Prefix every key with your app or library name (`app:user`, `mylib:cart`) so two callers cannot collide.

</Callout>

### Serialization

Mochi serializes values with [`devalue`](https://www.npmjs.com/package/devalue), so `Map`, `Set`, `Date`, `URL`, `BigInt`, and circular references round-trip. Promises work too — Svelte stitches them back together on the client.

### Limitations in Mochi today

<Callout type="warning">

**Server islands.** A `mochi:defer` server island renders in a separate request, and its serialized values are not merged into the parent page. Keep `hydratable()` calls in the page or in eagerly hydrated islands.

**No CSP nonce wiring.** Mochi does not yet pass a `csp.nonce` to Svelte's `render()`, so the inline lookup script is blocked under strict `script-src`. Allow `'unsafe-inline'` for scripts, or wait for nonce support.

</Callout>

<SeeItInAction
demos={[{ href: "/demos/hydratable/", title: "Hydratable", hook: "How hydratable() works — compute a value once on the server and reuse it on the client instead of re-running async work during hydration." }]}
/>
