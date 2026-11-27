---
title: 'Cache'
slug: cache
ogTitle: 'Caching with stale-while-revalidate'
description: 'Cache server-side data with stale-while-revalidate semantics using MochiCache.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
  import PersistenceTable from './_components/PersistenceTable.svelte';
</script>

## Cache

<VersionNote since="0.8.0" href="/blog/mochi-0-8-0/" />

`MochiCache` caches server-side data — typically slow upstream API calls — with stale-while-revalidate semantics. Construct it once at module scope and share the instance across requests.

<PersistenceTable feature="cache" />

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

**A cache is shared across requests in one process.** So a key like `cart:current` leaks one user's data to another. Prefix per-user keys with the user id, for example `cart:${userId}`, and do the same for any other request-scoped dimension (tenant, locale, role).

</Callout>

### Caching expensive serverProps

A page's latency is usually dominated by its data loading, not the render — so `serverProps` resolvers are the highest-leverage place to cache. Construct a `MochiCache` at module scope and wrap the slow call in `fetch()`, keyed per route params:

```ts
// file: src/index.ts
import { Mochi, MochiCache } from 'mochi-framework';
import { loadPokemon } from './lib/pokemon';

const pokemonCache = new MochiCache({
  minTimeToStale: 10_000, // serve fresh for 10s
  maxTimeToLive: 300_000, // hard expiry at 5min
});

await Mochi.serve({
  routes: {
    '/pokemon/:id': Mochi.page('./src/Pokemon.svelte', {
      serverProps: async (_req, params) => ({
        pokemon: await pokemonCache.fetch(`pokemon:${params.id}`, () => loadPokemon(params.id)),
      }),
    }),
  },
});
```

The first request per key pays the load; later requests follow the fresh / stale / expired lifecycle below. Everything that shapes the result must be in the key — route params as above, plus any cookie- or locals-derived dimension per the warning above.

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
| `whenIdle()`               | `Promise<void>`                      |

`peek(key)` reports a key's `status` and value **without** running `fn`, revalidating, or emitting `cache:read` — a pure probe that returns `null` on a miss. `markStale(key)` backdates an entry so its next read serves stale-while-revalidate. It is a no-op on a missing or already-stale key, and it never freshens or un-expires one. Both run through the `storage` interface, so they apply to any backend. `set(key, value)` writes a value directly, stamped fresh. Prefer `set` over `delete(key)` then `fetch`: that sequence leaves the key absent, so concurrent readers each start their own recompute.

`status` is `'fresh' | 'stale' | 'expired' | 'miss'`.

#### Waiting for background revalidations

<VersionNote since="0.10.0" message="whenIdle() was added in 0.10.0." />

A stale read returns at once and refreshes in the background, so the new value is not readable when `fetch` resolves. `whenIdle()` waits for those background runs to finish — including the storage write, not just the upstream call — which is what you want before shutting down, or in a test that asserts on the refreshed value.

```ts
const stale = await cache.fetchWithStatus('users', loadUsers); // 'stale', old value
await cache.whenIdle();
const fresh = await cache.fetchWithStatus('users', loadUsers); // 'fresh', new value
```

<Callout type="warning">

`whenIdle()` waits for whatever is in flight, so on a busy cache it keeps waiting as new revalidations start. Treat it as a shutdown or test primitive — don't await it on a request path.

</Callout>

A run that throws settles it like any other, so a failing upstream can't leave it hanging. `ImageCache` exposes the same method for its own regenerations.

### Options

| Option           | Default           |
| ---------------- | ----------------- |
| `minTimeToStale` | `5_000` (5s)      |
| `maxTimeToLive`  | `600_000` (10min) |
| `storage`        | `MemoryStorage`   |
| `serialize`      | none (`v => v`)   |
| `deserialize`    | none (`v => v`)   |

Four storage backends ship with the framework: `MemoryStorage` (the default), `FileStorage`, `SqliteStorage`, and `PostgresStorage`. Any other backend — for example Redis — needs a `storage` you write yourself, implementing `getItem` / `setItem` / `removeItem` / `clear`. Those methods may be synchronous or `async`. The cache awaits every call. When a custom backend needs a string or buffer, supply `serialize` / `deserialize` — for example `serialize: JSON.stringify, deserialize: JSON.parse`.

The default `MemoryStorage` accepts `{ maxAge, purgeInterval }` for age-based eviction. With no options it never evicts.

See [Persistence](/docs/persistence/) for how cache storage compares to the other stateful subsystems.

### File-based storage

`FileStorage` persists each entry as a JSON file on disk, so it survives restarts without a database (see [Persistence](/docs/persistence/)). It needs no `serialize` / `deserialize`:

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

A background sweep deletes expired files on an interval. `purgeOnInit` empties the directory on startup.

Binary fields (`Uint8Array` / `Buffer`) anywhere in a value round-trip transparently. By default Mochi inlines them as base64 in the JSON and returns them as `Uint8Array`. When values carry large binaries, set `offloadBinary: true`: Mochi writes each binary to its own file in a `<key-hash>/` folder and puts a pointer in the JSON instead of base64. An offloaded field reads back as a lazy blob reference, so a metadata read never loads the bytes. Resolve one with `readBlobRef(ref)`, and narrow a value with `isBlobRef(value)`. Deleting a key also removes its blob folder. Pointers already on disk always decode, so the flag never orphans existing entries. The built-in [image cache](/docs/images/) enables offloading internally.

| Option          | Default           |                                                                            |
| --------------- | ----------------- | -------------------------------------------------------------------------- |
| `directory`     | _(required)_      | Where cache files are written; created if missing.                         |
| `purgeOnInit`   | `false`           | Delete the directory's contents when the adapter is constructed.           |
| `purgeInterval` | `60_000` (1min)   | Background sweep interval in ms. `<= 0` disables the sweeper.              |
| `maxAge`        | `600_000` (10min) | Files older than this are deleted by the sweep.                            |
| `offloadBinary` | `false`           | Offload binary fields to per-key blob files, read back as lazy `BlobRef`s. |

Only one background sweeper runs per cache directory per process. A new `FileStorage` on the same directory transfers the sweep to the newest instance, and with it that instance's `maxAge`, so a dev-server reload that re-runs your module never stacks up duplicate sweepers. Ownership never moves back: `dispose()` on the newest instance ends the sweep for that directory, even if an older instance is still in use.

<Callout type="warning">

**Keep `maxAge` at or above `maxTimeToLive`.** The sweep deletes files past `maxAge`. Set it lower and the sweeper removes entries the cache still wants to serve stale, turning a fast stale read into a blocking recompute. Values must be JSON-serializable (no `Date`, `Map`, `BigInt`, or `undefined` round-trip).

</Callout>

<Callout type="warning">

**In-flight de-duplication is per-server.** Concurrent calls for the same key on one instance share a single `fn` invocation. With multiple instances behind a shared backend, each instance de-duplicates only its own requests, so on a cold key every instance may run `fn` once and race to write the same entry. The shared store keeps results consistent.

</Callout>

If a `storage` call throws, the cache degrades instead of failing the request: a read error recomputes via `fn` (reported as a `miss`), a write error returns the freshly computed value uncached, and a `delete` error is re-thrown to the caller. Every case emits a `cache:error` event.

### SQLite and Postgres storage

<VersionNote since="0.10.0" message="SqliteStorage and PostgresStorage ship in 0.10.0." />

`SqliteStorage` persists entries to a local SQLite file (in WAL mode), and `PostgresStorage` shares entries across multiple server instances. Both store values exactly as `FileStorage` does without `offloadBinary` — JSON, with `Uint8Array` / `Buffer` fields at any depth read back as `Uint8Array` — so they need no `serialize` / `deserialize`:

```ts
// src/lib/cache.ts
import { MochiCache, SqliteStorage, PostgresStorage } from 'mochi-framework';

export const pokemonCache = new MochiCache({
  minTimeToStale: 10_000,
  maxTimeToLive: 300_000,
  storage: new SqliteStorage({
    path: './.db/cache.sqlite',
    namespace: 'pokemon',
    maxAge: 300_000, // must be >= maxTimeToLive
  }),
});

export const sharedFeedCache = new MochiCache({
  minTimeToStale: 10_000,
  maxTimeToLive: 300_000,
  crossProcessInflight: true,
  storage: new PostgresStorage({
    url: process.env.DATABASE_URL!,
    namespace: 'feed',
    maxAge: 300_000,
  }),
});
```

Multiple `MochiCache` instances can share one SQLite file or Postgres database by setting distinct `namespace` values — `clearItems()`, `count()`, `keys()`, `purgeOnInit`, and `sweep()` only affect that cache's namespace. Keys can be any string of any length, as with `FileStorage`.

Values must be JSON-serializable: `Date`, `Map`, `BigInt`, and `undefined` do not round-trip. Only one background sweeper runs per `(database, namespace)` per process.

| Option          | Default           |                                                                              |
| --------------- | ----------------- | ---------------------------------------------------------------------------- |
| `path` / `url`  | _(required)_      | SQLite file path (`SqliteStorage`) or `postgres://` URL (`PostgresStorage`). |
| `namespace`     | `'default'`       | Keyspace isolating this cache from others sharing the same database.         |
| `purgeOnInit`   | `false`           | Clear this namespace's existing entries before the first read or write.      |
| `purgeInterval` | `60_000` (1min)   | Background sweep interval in ms. `<= 0` disables the sweeper.                |
| `maxAge`        | `600_000` (10min) | Entries older than this are deleted by the sweep (`>= maxTimeToLive`).       |

#### Schema

The storage creates what it needs the first time it is used: a `mochi_cache` table and a `mochi_migrations_cache` table that tracks the cache's own migrations. Nothing is created until then — `Mochi.serve({ storage })` and `mochi-framework migrate` never touch the cache — and the tables go into the database the storage points at, which need not be the app's.

On Postgres both tables are created in the connection's current schema (the first entry of `search_path`), so apps that each have their own schema each get their own cache. The role needs `CREATE` on that schema the first time only; once the tables exist, a role without it can use them.

#### Connections

Every `SqliteStorage` / `PostgresStorage` on the same database shares one client, however many instances and namespaces there are. For Postgres that is a pool of at most 4 connections, closed after 30 seconds without use. `await storage.dispose()` stops the instance's background sweeper and releases its share; the client closes when the last instance has released it. A dev-server reload hands the previous copy's sweeper and share to the new one.

`PostgresStorage` uses no session state: single statements without named prepared statements, and one transaction for its schema. It therefore works through a transaction-mode connection pooler such as PgBouncer — unlike [database migrations](/docs/database-migrations/#concurrency), which need a direct connection.

The database, user, host and port named in the URL always apply, even when `PGDATABASE` and the other `PG*` variables are set.

#### When the database is slow or unreachable

A cache must not hold a request up, so both backends give up early and let `MochiCache` treat the call as a miss (see the `cache:error` event below):

- **Postgres** — connecting may take 5 seconds and one statement 5 seconds. After such a failure every call fails immediately for 5 seconds, then a single call tries the database again.
- **SQLite** — a statement waits at most 250 ms for another process's write lock, because SQLite waits by blocking the whole server. After a busy write, writes fail immediately for 1 second; reads carry on, since WAL readers never wait for the writer. Opening the file may wait up to 5 seconds, once.

The sweep deletes expired entries 1,000 at a time and yields in between, so a large backlog does not hold a lock, or the server, for long. `SqliteStorage` needs a file system that supports WAL mode.
