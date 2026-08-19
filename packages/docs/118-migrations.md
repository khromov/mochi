---
title: 'Migrations'
slug: migrations
ogTitle: 'Forward-only SQL migrations with Mochi'
description: 'Forward-only .sql migrations for SQLite and Postgres, applied automatically on startup.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
  import PersistenceTable from './_components/PersistenceTable.svelte';
</script>

## Migrations

<VersionNote since="0.10.0" message="The storage option and the migrations runner ship in 0.10.0." />

Declare your app database with the `storage` option and Mochi applies pending `.sql` migrations against it on startup — before routes compile, before the server binds, before any of your code can touch the database. A failed migration fails the boot.

<PersistenceTable feature="migrations" />

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3333,
  routes: {/* … */},
  storage: { sqlite: './.db/app.db' }, // or { postgres: process.env.DATABASE_URL }
});
```

```sql
-- file: migrations/sqlite/1_create-users.sql
CREATE TABLE users (
  id integer PRIMARY KEY,
  email text NOT NULL UNIQUE
);
```

Migrations live in `migrations/sqlite/` or `migrations/postgres/` at the project root. Both folders can coexist — only the one matching `storage` runs, so an app that maintains both can switch database types freely.

### Rules

- Files are named `<id><separator><name>.sql` — `1_init.sql`, `2-add-users.sql`. Ids start at 1 and are consecutive; gaps and duplicates are boot errors.
- Runs are **forward-only**. There are no down migrations — to undo something, add a new migration.
- Each migration runs in its own transaction together with its bookkeeping row, so a failed file leaves nothing half-applied and re-runs cleanly after you fix it.
- Applied migrations are recorded in a `migrations` table (id, name, content hash, timestamp) and verified on every boot.

<Callout type="warning">

**Applied migrations are immutable.** Editing, deleting, or renumbering an already-applied file is a boot error — the stored hash no longer matches. Ship changes as a new migration instead.

</Callout>

A `-- migrate:no-transaction` comment anywhere in a file runs it outside a transaction, for statements that refuse to run inside one (`CREATE INDEX CONCURRENTLY`, `VACUUM`). Such a file cannot be applied atomically with its bookkeeping row, so write it idempotently (`IF NOT EXISTS`) — a crash between the two steps re-runs it on the next boot.

### Workers and concurrency

`Mochi.worker({ storage })` applies migrations on `start()`, before polling begins, with the same semantics. When a serve and a worker share one process and one storage, migrations run once. Across processes, Postgres runners serialize on an advisory lock, so replicas booting simultaneously apply each migration exactly once; SQLite runs each migration under `BEGIN IMMEDIATE`, so a racing second process fails its bookkeeping insert and rolls back rather than double-applying.

Mochi also keeps a second table, `mochi_migrations`, in the same database: framework-internal migrations for built-in features, applied before yours. Both tables follow the same rules; leave `mochi_migrations` alone.

### CLI and programmatic use

`bunx mochi-framework migrate` applies pending migrations without booting the server, reading `storage` from your entry's `Mochi.serve()` call. See [CLI](/docs/cli/).

| Option           | Description                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| `--entry <path>` | Entry calling `Mochi.serve({ storage })`. Default: `./src/index.ts`.           |
| `--validate`     | Check file naming and ordering in both folders — no entry import, no database. |

`runMigrations` is the underlying runner, exported for scripts and tests:

```ts
import { runMigrations } from 'mochi-framework';

const applied = await runMigrations({
  storage: { postgres: process.env.DATABASE_URL! },
  dir: 'migrations/postgres',
});
```
