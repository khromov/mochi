---
title: 'Options'
slug: options
description: 'Persistent key/value storage for small app data with MochiOptions, on SQLite, Postgres, or embedded PGlite.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
  import PersistenceTable from './_components/PersistenceTable.svelte';
</script>

## Options

<VersionNote since="0.10.0" message="MochiOptions ships in the next Mochi release (0.10.0); this page describes the upcoming API." />

Store a little application data — settings, feature flags, small state — without setting up a database. `MochiOptions` is a persistent key/value store with five async methods, importable anywhere server-side, including `.svelte` components:

```ts
import { MochiOptions } from 'mochi-framework';

await MochiOptions.set('dark_mode', true); // insert-only — throws if the key exists
await MochiOptions.get('dark_mode'); // true
await MochiOptions.update('dark_mode', false); // upsert — insert or overwrite
await MochiOptions.modify('views', (n) => (n ?? 0) + 1); // atomic read-modify-write
await MochiOptions.delete('dark_mode'); // true — the key existed
```

### Storage

<PersistenceTable feature="options" />

`MochiOptions` requires a persistent backend, configured once in `Mochi.serve()`:

```ts
await Mochi.serve({
  routes: {/* … */},
  optionsStorage: { sqlite: '.db/options.sqlite' },
  // optionsStorage: { postgres: process.env.DATABASE_URL },
  // optionsStorage: { pglite: await PGlite.create('.db/options-pglite') },
});
```

| Storage                | Scope                                          |
| ---------------------- | ---------------------------------------------- |
| `{ sqlite: path }`     | single process, one durable file               |
| `{ postgres: url }`    | shared — multiple processes see the same store |
| `{ pglite: instance }` | single process, embedded in-process Postgres   |

<Callout type="warning">

**There is no memory backend.** The options store exists to persist across restarts, so `optionsStorage: 'memory'` is a boot error, and calling any `MochiOptions` method without a configured `optionsStorage` throws at runtime.

</Callout>

In a [standalone worker](/docs/queues/#standalone-workers) — a process that never calls `Mochi.serve()` — pass the same option to `Mochi.worker()` so processors can use `MochiOptions`:

```ts
const worker = Mochi.worker({
  queues: [emails],
  optionsStorage: { sqlite: '.db/options.sqlite' },
});
```

The storage shape is validated at boot; the connection and schema are created lazily on the first `MochiOptions` call, so a connection problem surfaces there. Postgres storage installs a single table into a dedicated `mochi_options` schema, away from your application's tables. As with [queue storage](/docs/queues/#pglite), a PGlite instance is constructed and owned by you — Mochi never closes it. Sharing one instance between `queueStorage` and `optionsStorage` is supported: statements are serialized through a shared per-instance lock, so an options write never interleaves with a queue transaction.

### `get()`

```ts
const theme = await MochiOptions.get<string>('theme'); // string | undefined
const perPage = await MochiOptions.get('per_page', 20); // 20 when missing
```

Resolves the stored value, or `undefined` when the key is missing. Pass a fallback to get it back on a miss instead — the fallback is only returned, never written. A stored `null` is a hit, so the fallback does not apply to it. Reads are never cached: every `get()` hits the database. Wrap hot reads in [`requestCache()`](/docs/request-cache/) or a [`MochiCache`](/docs/cache/) if that matters.

### `set()` and `update()`

`set(key, value)` is insert-only: it throws when the key already exists, so concurrent first-writes cannot silently overwrite each other — exactly one wins. `update(key, value)` upserts: it inserts a missing key and overwrites an existing one, last writer wins.

Values are serialized with [devalue](https://github.com/sveltejs/devalue), so rich types survive the round-trip:

```ts
await MochiOptions.update('maintenance', {
  since: new Date(),
  allowed: new Set(['admin', 'ops']),
  limits: new Map([['api', 100n]]),
});
```

`undefined` is not a storable value (it is `get()`'s miss signal) — store `null` or `delete()` the key instead.

### `modify()`

`modify(key, fn)` is the atomic read-modify-write: it reads the current value (`undefined` when the key is missing), passes it to `fn`, and writes the result — resolving the value it wrote:

```ts
const views = await MochiOptions.modify<number>('views', (n) => (n ?? 0) + 1);
```

Unlike a `get()` followed by an `update()`, a concurrent writer cannot be lost: each row carries a version, and the write only lands if the version is unchanged since the read. When another writer got there first, `modify()` re-reads and re-runs `fn` with jittered backoff between rounds (giving up after 20 attempts under pathological contention).

<Callout type="warning">

**`fn` may run more than once**, so it must be pure — no side effects inside it. `fn` can be async, and like the other write methods it must not return `undefined`.

</Callout>

### `delete()`

`delete(key)` removes the key and resolves `true` when it existed, `false` when there was nothing to remove.

### Concurrency

Every method is a single atomic SQL statement, except `modify()`, which is a version-checked read/write loop. Concurrent `set()`s of one key let exactly one caller win; the rest throw. `update()` is last-writer-wins — a plain `get()` followed by an `update()` is two statements, and another writer can land between them. When the new value depends on the old one, use `modify()`.
