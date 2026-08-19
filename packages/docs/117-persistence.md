---
title: 'Persistence'
slug: persistence
description: 'Which storage backends each stateful Mochi feature supports — in-memory, file, SQLite, Postgres, or your own store.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import PersistenceTable from './_components/PersistenceTable.svelte';
</script>

## Persistence

A few Mochi features keep server-side state that outlives a single request — queued jobs, cached values, rate-limit counters, spent captcha nonces. Each one defaults to in-memory storage and can be pointed at something durable instead.

<PersistenceTable />

### Per feature

- **[Queues](/docs/queues/)** — in-memory by default. Point the serve-level `queueStorage` (or a descriptor's `storage`) at a SQLite file (`{ sqlite: path }`), a Postgres database (`{ postgres: url }`), or an embedded PGlite instance (`{ pglite }`). One store serves every queue; Postgres storage is shared, so multiple processes can work one backlog.
- **[Migrations](/docs/migrations/)** — the serve-level `storage` (`{ sqlite: path }` or `{ postgres: url }`) names the app database; forward-only `.sql` files from `migrations/<sqlite|postgres>/` are applied against it on startup. No in-memory mode — migrations only make sense against something durable.
- **[Cache](/docs/cache/)** — `new MochiCache({ storage })`. Defaults to `MemoryStorage`; `FileStorage` writes one JSON file per entry. Built-in SQLite and Postgres backends are planned; until then any other backend is a `Storage` implementation (`getItem` / `setItem` / `removeItem` / `clear`), with `serialize` / `deserialize` when the backend needs strings.
- **[Image cache](/docs/images/)** — the one feature that persists by default: `FileStorage` under `cacheDir`. Pass `image: { storage }` to swap it (e.g. `new MemoryStorage()`); `cacheDir` is then ignored.
- **[Rate limiting](/docs/rate-limiting/)** — `rateLimit: { store }`. `memoryStore()` (default), `sqliteStore({ path })` and `postgresStore({ url })` all ship with the framework; `MochiRateLimitStore` is the interface for your own. Create the store once and share the instance across routes.
- **[Captcha](/docs/captcha/)** — `captcha: { store: 'memory' | 'sqlite' }`, plus `storePath` for the SQLite file. A custom `NonceStore` needs only `consume(nonce, expiresAt)`.

### Choosing a backend

| Backend       | Survives restart | Shared across instances | Use it when                                                     |
| ------------- | ---------------- | ----------------------- | --------------------------------------------------------------- |
| **In-memory** | No               | No                      | Development, single-process apps, state that's cheap to rebuild |
| **File**      | Yes              | Only on shared storage  | Caches whose entries are large blobs (images, API responses)    |
| **SQLite**    | Yes              | Only on shared storage  | One host, one process — durability without another service      |
| **Postgres**  | Yes              | Yes                     | Several instances behind a load balancer                        |

<Callout type="warning">

In-memory state is **per process**. Two instances of your app each get their own rate-limit counters and their own spent-nonce set, so limits effectively multiply and a captcha nonce can be replayed once per instance. Pick a shared backend before you scale out.

</Callout>
