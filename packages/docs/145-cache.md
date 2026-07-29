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

| Method                     | Returns                              |
| -------------------------- | ------------------------------------ |
| `fetch(key, fn)`           | `Promise<T>`                         |
| `fetchWithStatus(key, fn)` | `Promise<{ value, status }>`         |
| `peek(key)`                | `Promise<{ value, status } \| null>` |
| `set(key, value)`          | `Promise<void>`                      |
| `markStale(key)`           | `Promise<void>`                      |
| `delete(key)`              | `Promise<void>`                      |
| `clearItems()`             | `Promise<void>`                      |

`clearItems()` empties the whole cache in one call.

`peek(key)` reports a key's current `status` and value **without** running `fn`, revalidating, or emitting `cache:read` — a pure probe (returns `null` on a miss). `markStale(key)` backdates an entry so its next read is served stale-while-revalidate; it's a no-op on a missing or already-stale key and never freshens or un-expires one. Both work through the `storage` interface, so they apply to any backend.

`set(key, value)` writes a value directly, stamped fresh, overwriting whatever is there — the counterpart to `fetch`, which only computes on a miss or stale read and so can't replace a still-present entry. Reach for it instead of `delete(key)` followed by `fetch`: that sequence leaves the key absent for the whole write, and concurrent readers hitting that gap each start their own recompute.

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

The default `MemoryStorage` accepts `{ maxAge, purgeInterval }` for age-based eviction, mirroring `FileStorage` below — `new MemoryStorage({ maxAge: 300_000, purgeInterval: 60_000 })`. With no options it never evicts (the prior, still-default behavior).

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

Binary fields (`Uint8Array` / `Buffer`) anywhere in a value round-trip transparently — by default they're inlined as base64 in the JSON and come back as `Uint8Array`, nothing to manage. For values carrying large binaries, opt into `offloadBinary: true`: each binary is written to its own file in a `<key-hash>/` folder and replaced by a pointer in the JSON instead of base64-bloating it. Offloaded fields read back as lazy blob references — resolve one with `readBlobRef(ref)` (`isBlobRef(value)` narrows) — so a metadata read never loads the bytes. Deleting a key removes its blob folder with it, and pointers already on disk always decode, so flipping the flag never orphans existing entries. The built-in [image cache](/docs/images/) enables offloading internally.

| Option          | Default           |                                                                            |
| --------------- | ----------------- | -------------------------------------------------------------------------- |
| `directory`     | _(required)_      | Where cache files are written; created if missing.                         |
| `purgeOnInit`   | `false`           | Delete the directory's contents when the adapter is constructed.           |
| `purgeInterval` | `60_000` (1min)   | Background sweep interval in ms. `<= 0` disables the sweeper.              |
| `maxAge`        | `600_000` (10min) | Files older than this are deleted by the sweep.                            |
| `offloadBinary` | `false`           | Offload binary fields to per-key blob files, read back as lazy `BlobRef`s. |

Only one background sweeper runs per cache directory per process. Constructing another `FileStorage` on the same directory transfers the sweep to the newest instance (and with it that instance's `maxAge`), so a dev-server reload that re-runs your module never stacks up duplicate sweepers.

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
| `cache:delete`            | `{ key }`                   | A key was removed via `delete(key)`.                         |
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

### Per-request memoization

`MochiCache` is process-wide and outlives the request. To collapse repeated work _within_ a single render — the same lookup called from ten components — reach for the [request cache](/docs/request-cache/) instead, which needs no TTL because entries die with the request.

### Server-only

`MochiCache` lives on the server. Importing it into a hydratable island throws — caches are shared per-process state and don't make sense in the browser. Construct cache instances in `.ts` modules or page-route scripts, never inside a `mochi:hydrate` component.

<SeeItInAction
demos={[
{ href: "/demos/data-loading/", title: "Data Loading", hook: "How server-side data loading works — fetch on the server, cache with MochiCache, and render at request time." },
{ href: "/demos/cache-events/", title: "Cache Events", hook: "How cache events work — subscribe to MochiCache lifecycle events (hit, miss, set, evict) through mochiEvents for observability." },
{ href: "/cookie-vary-test/", title: "Cookie Vary Test", hook: "How cookie-partitioned caching works — a page that sets Vary: Cookie so responses key on cookies." },
]}
/>
