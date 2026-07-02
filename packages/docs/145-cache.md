---
title: 'Cache'
slug: cache
description: 'Cache server-side data with stale-while-revalidate semantics using MochiCache.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
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
| `clearItems()`             | `Promise<void>`              |

`clearItems()` empties the whole cache in one call.

`status` is `'fresh' \| 'stale' \| 'expired' \| 'miss'`.

### Options

| Option           | Default           |
| ---------------- | ----------------- |
| `minTimeToStale` | `5_000` (5s)      |
| `maxTimeToLive`  | `600_000` (10min) |
| `storage`        | in-memory `Map`   |
| `serialize`      | identity          |
| `deserialize`    | identity          |

For multi-process or persistent caching, pass a custom `storage` that implements `getItem` / `setItem` / `removeItem` / `clear` (e.g. Redis, SQLite via `bun:sqlite`). These methods may be synchronous (in-memory `Map`, `bun:sqlite`) or `async` / Promise-returning (Redis, network stores) — the cache awaits every call. Each key holds a single entry (the value plus its write time). When a backend needs a string or buffer — like Redis — supply `serialize` / `deserialize` to encode and decode that entry, e.g. `serialize: JSON.stringify, deserialize: JSON.parse`.

### File-based storage

`FileStorage` persists each entry as a JSON file on disk, so the cache survives restarts. It's turnkey — no `serialize` / `deserialize` needed:

```ts
import { MochiCache, FileStorage } from 'mochi-framework';

export const pokemonCache = new MochiCache({
  minTimeToStale: 10_000,
  maxTimeToLive: 300_000,
  storage: new FileStorage({
    directory: './.cache/pokemon',
    maxAge: 300_000, // must be >= maxTimeToLive
  }),
});
```

Stale-while-revalidate works exactly as with in-memory storage — the entry's write time lives inside the file. A background sweep runs on an interval to delete expired files (there's no read-time eviction otherwise), and `purgeOnInit` empties the directory on startup.

| Option          | Default           |                                                                  |
| --------------- | ----------------- | ---------------------------------------------------------------- |
| `directory`     | _(required)_      | Where cache files are written; created if missing.               |
| `purgeOnInit`   | `false`           | Delete the directory's contents when the adapter is constructed. |
| `purgeInterval` | `60_000` (1min)   | Background sweep interval in ms. `<= 0` disables the sweeper.    |
| `maxAge`        | `600_000` (10min) | Files older than this are deleted by the sweep.                  |

<Callout type="warning">

**Keep `maxAge` at or above `maxTimeToLive`.** The sweep deletes files past `maxAge` — set it lower and the sweeper would remove entries the cache still wants to serve stale, turning a fast stale read into a blocking recompute. Values must be JSON-serializable (no `Date`, `Map`, `BigInt`, or `undefined` round-trip).

</Callout>

<Callout type="warning">

**In-flight de-duplication is per-server.** Concurrent calls for the same key on one instance share a single `fn` invocation, but that coordination lives in process memory. With multiple instances behind a shared backend (`bun:sqlite`, Redis), each instance de-duplicates only its own requests — so on a cold key, every instance may run `fn` once and race to write the same entry. The shared store keeps results consistent; it does not collapse the concurrent fetches into one.

</Callout>

If a `storage` call throws, the cache degrades instead of failing the request: a read error recomputes via `fn` (reported as a `miss`), a write error returns the freshly computed value uncached, and a `delete` error is re-thrown to the caller. Every case also emits a `cache:error` event.

### Subscribing to cache events

`MochiCache` emits these events on `mochiEvents`:

| Event                     | Payload                     | When                                                         |
| ------------------------- | --------------------------- | ------------------------------------------------------------ |
| `cache:read`              | `{ key, status }`           | Every cache lookup, regardless of which method ran.          |
| `cache:revalidate`        | `{ key }`                   | A background refetch starts (stale read).                    |
| `cache:sweep`             | `{ removed, durationMs }`   | A `FileStorage` background sweep deleted expired files.      |
| `cache:revalidate:failed` | `{ key, error }`            | A background refetch threw; the stale value is still served. |
| `cache:error`             | `{ key, operation, error }` | A `storage` `get` / `set` / `remove` call threw.             |

`consoleLogger()` surfaces `cache:revalidate:failed` and `cache:error` as warnings — a silently degrading upstream or storage backend is otherwise invisible.

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

See the [Cache Events demo](/demos/cache-events/) for a working example that pipes events into an in-memory ring buffer and renders them on the page.

### Server-only

`MochiCache` lives on the server. Importing it into a hydratable island throws — caches are shared per-process state and don't make sense in the browser. Construct cache instances in `.ts` modules or page-route scripts, never inside a `mochi:hydrate` component.

<SeeItInAction
demos={[
{ href: "/demos/data-loading/", title: "Data Loading", hook: "Server-side fetch from PokéAPI cached via MochiCache and rendered at request time." },
{ href: "/demos/cache-events/", title: "Cache Events", hook: "Subscribe to MochiCache lifecycle events through mochiEvents and log them to the server console." },
{ href: "/cookie-vary-test/", title: "Cookie Vary Test", hook: "A page that sets Vary: Cookie on its response — useful for testing cookie-partitioned cache keys." },
]}
/>
