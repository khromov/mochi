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

`MochiCache` caches server-side data — typically slow upstream API calls — with stale-while-revalidate semantics. Construct it once at module scope and share the instance across requests.

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

**Caches are shared in-process.** Every request reads from the same `Map`, so a key like `cart:current` leaks one user's data to another. Prefix per-user keys with the user id, for example `` `cart:${userId}` ``, and do the same for any other request-scoped dimension (tenant, locale, role).

</Callout>

### Behavior

- **Fresh** (within `minTimeToStale`): cached value returned, no fetch.
- **Stale** (between `minTimeToStale` and `maxTimeToLive`): cached value returned at once, fetch runs in the background and updates the cache.
- **Expired** (past `maxTimeToLive`): fetch runs synchronously and the caller waits.

### API

| Method                     | Returns                              |
| -------------------------- | ------------------------------------ |
| `fetch(key, fn)`           | `Promise<T>`                         |
| `fetchWithStatus(key, fn)` | `Promise<{ value, status }>`         |
| `peek(key)`                | `Promise<{ value, status } \| null>` |
| `set(key, value)`          | `Promise<void>`                      |
| `markStale(key)`           | `Promise<void>`                      |
| `delete(key)`              | `Promise<void>`                      |
| `clearItems()`             | `Promise<void>`                      |

`peek(key)` reports a key's `status` and value **without** running `fn`, revalidating, or emitting `cache:read` — a pure probe that returns `null` on a miss. `markStale(key)` backdates an entry so its next read serves stale-while-revalidate. `set(key, value)` writes a value directly, stamped fresh. Prefer `set` over `delete(key)` then `fetch`: that sequence leaves the key absent, so concurrent readers each start their own recompute.

`status` is `'fresh' | 'stale' | 'expired' | 'miss'`.

### Options

| Option           | Default           |
| ---------------- | ----------------- |
| `minTimeToStale` | `5_000` (5s)      |
| `maxTimeToLive`  | `600_000` (10min) |
| `storage`        | in-memory `Map`   |
| `serialize`      | identity          |
| `deserialize`    | identity          |

For multi-process or persistent caching, pass a custom `storage` that implements `getItem` / `setItem` / `removeItem` / `clear` (Redis, SQLite via `bun:sqlite`). Those methods may be synchronous or `async`; the cache awaits every call. When a backend needs a string or buffer, supply `serialize` / `deserialize` — for example `serialize: JSON.stringify, deserialize: JSON.parse`.

The default `MemoryStorage` accepts `{ maxAge, purgeInterval }` for age-based eviction. With no options it never evicts.

### File-based storage

`FileStorage` persists each entry as a JSON file on disk, so the cache survives restarts. It needs no `serialize` / `deserialize`:

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

A background sweep deletes expired files on an interval. `purgeOnInit` empties the directory on startup. Binary fields round-trip transparently (inlined as base64 by default; set `offloadBinary: true` to write large binaries to their own files). The built-in [image cache](/docs/images/) enables offloading internally.

| Option          | Default           |                                                                            |
| --------------- | ----------------- | -------------------------------------------------------------------------- |
| `directory`     | _(required)_      | Where cache files are written; created if missing.                         |
| `purgeOnInit`   | `false`           | Delete the directory's contents when the adapter is constructed.           |
| `purgeInterval` | `60_000` (1min)   | Background sweep interval in ms. `<= 0` disables the sweeper.               |
| `maxAge`        | `600_000` (10min) | Files older than this are deleted by the sweep.                            |
| `offloadBinary` | `false`           | Offload binary fields to per-key blob files, read back as lazy `BlobRef`s. |

<Callout type="warning">

**Keep `maxAge` at or above `maxTimeToLive`.** The sweep deletes files past `maxAge`. Set it lower and the sweeper removes entries the cache still wants to serve stale, turning a fast stale read into a blocking recompute. Values must be JSON-serializable (no `Date`, `Map`, `BigInt`, or `undefined` round-trip).

</Callout>

<Callout type="warning">

**In-flight de-duplication is per-server.** Concurrent calls for the same key on one instance share a single `fn` invocation. That coordination lives in process memory. With multiple instances behind a shared backend, each instance de-duplicates only its own requests, so on a cold key every instance may run `fn` once and race to write the same entry. The shared store keeps results consistent.

</Callout>

If a `storage` call throws, the cache degrades instead of failing the request: a read error recomputes via `fn` (reported as a `miss`), a write error returns the freshly computed value uncached, and a `delete` error is re-thrown to the caller. Every case emits a `cache:error` event.

### Subscribing to cache events

`MochiCache` emits these events on `mochiEvents`:

| Event                     | Payload                     | When                                                         |
| ------------------------- | --------------------------- | ------------------------------------------------------------ |
| `cache:read`              | `{ key, status }`           | Every cache lookup.                                          |
| `cache:revalidate`        | `{ key }`                   | A background refetch starts (stale read).                    |
| `cache:delete`            | `{ key }`                   | A key was removed via `delete(key)`.                         |
| `cache:sweep`             | `{ removed, durationMs }`   | A `FileStorage` background sweep deleted expired files.      |
| `cache:revalidate:failed` | `{ key, error }`            | A background refetch threw; the stale value is still served. |
| `cache:error`             | `{ key, operation, error }` | A `storage` `get` / `set` / `remove` call threw.             |

`consoleLogger()` surfaces `cache:revalidate:failed` and `cache:error` as warnings. Use `mochiEvents.setHandler` to attach a custom subscriber — it replaces a prior handler under the same name, so dev re-imports do not pile up listeners:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.setHandler('metrics:cache-read', 'cache:read', ({ key, status }) => {
  metrics.increment(`cache.${status}`, { key });
});
```

`consoleLogger()` prints `cache:revalidate` lines by default. Pass `{ cache: 'verbose' }` to print every read, or `{ cache: false }` to silence cache logging.

### Per-request memoization

`MochiCache` is process-wide and outlives the request. To collapse repeated work **within** a single render, use the [request cache](/docs/request-cache/) instead. It needs no TTL because entries die with the request.

### Server-only

`MochiCache` lives on the server. Importing it into a hydratable island throws. Construct cache instances in `.ts` modules or page-route scripts, never inside a `mochi:hydrate` component.

<SeeItInAction
demos={[
{ href: "/demos/data-loading/", title: "Data Loading", hook: "Fetch on the server, cache with MochiCache, and render at request time." },
{ href: "/demos/cache-events/", title: "Cache Events", hook: "Subscribe to MochiCache lifecycle events through mochiEvents." },
{ href: "/cookie-vary-test/", title: "Cookie Vary Test", hook: "A page that sets Vary: Cookie so responses key on cookies." },
]}
/>
