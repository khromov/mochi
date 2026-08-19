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

Mochi ships with a built-in migrations manager for your Postgres or SQLite tables. Declare your app database with the `storage` option and Mochi applies pending `.sql` migrations against it on startup. A failed migration fails the boot — `startOnFail: true` is the escape hatch that boots anyway and logs the error.

<PersistenceTable feature="migrations" />

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3333,
  routes: {/* … */},
  storage: { type: 'sqlite', path: './.db/app.db' },
  // or: { type: 'postgres', url: process.env.DATABASE_URL! }
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

### How migrations work

- Files are named `<id><separator><name>.sql` — `1_init.sql`, `2-add-users.sql`. Ids start at 1 and are consecutive; gaps and duplicates are boot errors.
- Runs are **forward-only** — to undo something, add a new migration.
- Each migration runs in its own transaction, so a failed file leaves nothing half-applied and re-runs cleanly after you fix it.
- Mochi keeps track of the migrations that have already run and never reapplies them.

Two tables appear in your database: `migrations` records your applied migrations, and `mochi_migrations` records framework-internal ones, applied before yours. Leave both to Mochi.

<Callout type="warning">

**Applied migrations are immutable.** Editing, deleting, or renumbering an already-applied file is a boot error — the stored hash no longer matches. Ship changes as a new migration instead.

</Callout>

A `-- migrate:no-transaction` comment anywhere in a file runs it outside a transaction on either database, for statements that refuse to run inside one (`CREATE INDEX CONCURRENTLY`, `VACUUM`). Write such a file idempotently (`IF NOT EXISTS`) — a crash mid-run, or a racing second process on SQLite, can execute it twice.

### Workers

`Mochi.worker({ storage })` applies pending migrations on `start()`, before polling begins.

### Concurrency

Concurrent runners are safe: Postgres replicas serialize on an advisory lock and SQLite re-checks inside a write transaction, so each migration applies exactly once.

### CLI

`bunx mochi-framework migrate` applies pending migrations without booting the server, reading `storage` from your entry's `Mochi.serve()` call. See [CLI](/docs/cli/).

| Option           | Description                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| `--entry <path>` | Entry calling `Mochi.serve({ storage })`. Default: `./src/index.ts`.           |
| `--validate`     | Check file naming and ordering in both folders — no entry import, no database. |

### runMigrations

Run migrations yourself — from a deploy step, a seed script, or a test — by pointing the exported runner at a folder:

```ts
import { runMigrations } from 'mochi-framework';

const applied = await runMigrations({
  storage: { type: 'postgres', url: process.env.DATABASE_URL! },
  dir: 'migrations/postgres',
});
console.log(applied); // [{ id: 1, filename: '1_create-users.sql' }]
```
