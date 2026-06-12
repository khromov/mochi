---
title: 'Cache'
slug: cache
description: 'Cache server-side data with stale-while-revalidate semantics using MochiCache.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Cache

`MochiCache` caches server-side data — typically slow upstream API calls — with stale-while-revalidate semantics. Construct once at module scope and share the instance across requests.

```ts
// src/lib/cache.ts
import { MochiCache } from 'mochi-framework';

export const pokemonCache = new MochiCache({
  minTimeToStale: 10_000, // serve fresh for 10s
  maxTimeToLive: 300_000, // hard expiry at 5min
});
```

Use it from a page or API route:

```svelte
<script>
  import { params } from 'mochi-framework';
  import { pokemonCache } from '../lib/cache';

  const id = params.id ?? 'pikachu';

  const pokemon = await pokemonCache.fetch(`pokemon:${id}`, async () => {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
    return res.ok ? await res.json() : null;
  });
</script>
```

<Callout type="warning">

**Caches are shared in-process.** Every request reads from the same `Map`, so a key like `cart:current` will leak one user's data to another. Prefix per-user keys with the user id — e.g. `` `cart:${userId}` `` — and do the same for any other request-scoped dimension (tenant, locale, role).

</Callout>

### Behaviour

- **Fresh** (within `minTimeToStale`): cached value returned, no fetch.
- **Stale** (between `minTimeToStale` and `maxTimeToLive`): cached value returned immediately, fetch runs in the background and updates the cache.
- **Expired** (past `maxTimeToLive`): fetch runs synchronously and the caller waits.

### API

| Method                     | Returns                      |
| -------------------------- | ---------------------------- |
| `fetch(key, fn)`           | `Promise<T>`                 |
| `fetchWithStatus(key, fn)` | `Promise<{ value, status }>` |
| `delete(key)`              | `Promise<void>`              |

`status` is `'fresh' \| 'stale' \| 'expired' \| 'miss'`.

### Options

| Option           | Default           |
| ---------------- | ----------------- |
| `minTimeToStale` | `5_000` (5s)      |
| `maxTimeToLive`  | `600_000` (10min) |
| `storage`        | in-memory `Map`   |
| `serialize`      | identity          |
| `deserialize`    | identity          |

For multi-process or persistent caching, pass a custom `storage` that implements `getItem` / `setItem` / `removeItem` (e.g. Redis, SQLite via `bun:sqlite`). Each key holds a single entry (the value plus its write time). When a backend needs a string or buffer — like Redis — supply `serialize` / `deserialize` to encode and decode that entry, e.g. `serialize: JSON.stringify, deserialize: JSON.parse`.

### Subscribing to cache events

`MochiCache` emits two events on `mochiEvents`:

| Event              | Payload           | When                                                |
| ------------------ | ----------------- | --------------------------------------------------- |
| `cache:read`       | `{ key, status }` | Every cache lookup, regardless of which method ran. |
| `cache:revalidate` | `{ key }`         | A background refetch starts (stale read).           |

`status` is `'fresh' \| 'stale' \| 'expired' \| 'miss'`. Use `mochiEvents.setHandler` to attach a custom subscriber — it replaces a prior handler under the same name, so dev re-imports don't pile up listeners:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.setHandler('metrics:cache-read', 'cache:read', ({ key, status }) => {
  metrics.increment(`cache.${status}`, { key });
});
```

`consoleLogger()` already prints `cache:revalidate` lines by default. Pass `{ cache: 'verbose' }` to also print every read, or `{ cache: false }` to silence cache logging:

```ts
import { consoleLogger } from 'mochi-framework';

consoleLogger({ cache: 'verbose' });
```

See the [Cache Events demo](/demos/cache-events/) for a worked example that pipes events into an in-memory ring buffer and renders them on the page.

### Server-only

`MochiCache` lives on the server. Importing it into a hydratable island throws — caches are shared per-process state and don't make sense in the browser. Construct cache instances in `.ts` modules or page-route scripts, never inside a `mochi:hydrate` component.
