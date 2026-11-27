import type { SQL } from 'bun';

/** First half of the two-key advisory lock ('moch' in ASCII); the second half is derived from the set's tracking table. */
const STORE_LOCK_NAMESPACE = 1836016488;
const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface StoreMigration {
  id: number;
  name: string;
  /** The migration's SQL, embedded in the bundle rather than read from disk. */
  sql: string;
}

/**
 * A framework feature's own schema: its migrations per database type and the table that tracks them. Unlike the app's
 * `migrations/` folder, a set is applied by the feature that owns it, on that feature's own connection, the first
 * time the feature is used.
 */
export interface StoreMigrationSet {
  /** Tracking table, e.g. `mochi_migrations_cache`. */
  table: string;
  sqlite: StoreMigration[];
  postgres: StoreMigration[];
}

export interface StoreMigrationOptions {
  /** Postgres `lock_timeout` (ms) for the run, so a stuck peer fails this run instead of hanging it. */
  lockTimeoutMs?: number;
}

export interface StoreMigrationResult {
  applied: StoreMigration[];
  /** Quote an identifier the set created; on Postgres also qualify it with the schema the run was pinned to. */
  qualify(name: string): string;
}

interface AppliedRow {
  id: number;
  hash: string;
}

function hashOf(migration: StoreMigration): string {
  return new Bun.CryptoHasher('sha256').update(migration.sql.replace(/\r\n/g, '\n')).digest('hex');
}

const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

function pendingAfter(applied: AppliedRow[], migrations: StoreMigration[], table: string): StoreMigration[] {
  if (applied.length > migrations.length) {
    throw new Error(
      `"${table}" records ${applied.length} applied migration(s) but this mochi-framework version ships ${migrations.length} — the database was migrated by a newer version.`,
    );
  }
  for (let i = 0; i < applied.length; i++) {
    const row = applied[i]!;
    const migration = migrations[i]!;
    if (Number(row.id) !== migration.id || row.hash !== hashOf(migration)) {
      throw new Error(`Migration ${migration.id} ("${migration.name}") recorded in "${table}" differs from the one this mochi-framework version ships.`);
    }
  }
  return migrations.slice(applied.length);
}

async function applyPending(tx: SQL, tracking: string, table: string, exists: boolean, migrations: StoreMigration[], appliedAt: string): Promise<StoreMigration[]> {
  // A fully migrated database is only read, so a role without CREATE can use a schema someone else provisioned.
  if (!exists) {
    await tx.unsafe(`CREATE TABLE ${tracking} (id integer PRIMARY KEY, name text NOT NULL, hash text NOT NULL, applied_at ${appliedAt})`);
  }
  const applied = (await tx.unsafe(`SELECT id, hash FROM ${tracking} ORDER BY id`)) as AppliedRow[];
  const pending = pendingAfter(applied, migrations, table);
  for (const migration of pending) {
    await tx.unsafe(migration.sql);
    await tx.unsafe(`INSERT INTO ${tracking} (id, name, hash) VALUES ($1, $2, $3)`, [migration.id, migration.name, hashOf(migration)]);
  }
  return pending;
}

async function applyPostgres(sql: SQL, set: StoreMigrationSet, opts: StoreMigrationOptions): Promise<StoreMigrationResult> {
  // One transaction with a transaction-scoped lock and settings: nothing outlives COMMIT, so unlike the app runner's
  // session lock this is safe behind a transaction-mode pooler, where consecutive statements may reach different sessions.
  return (await sql.begin(async (tx) => {
    if (opts.lockTimeoutMs && opts.lockTimeoutMs > 0) {
      await tx.unsafe(`SET LOCAL lock_timeout = ${Math.ceil(opts.lockTimeoutMs)}`);
    }
    const rows = (await tx.unsafe(`SELECT pg_advisory_xact_lock($1::integer, hashtext($2)), coalesce(current_schema(), 'public') AS schema`, [
      STORE_LOCK_NAMESPACE,
      set.table,
    ])) as {
      schema: string;
    }[];
    const schema = quote(rows[0]?.schema ?? 'public');
    // Unqualified names in the set's SQL must land in the schema the feature's queries are then pinned to.
    await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
    const tracking = `${schema}.${quote(set.table)}`;
    const present = (await tx.unsafe(`SELECT to_regclass($1) IS NOT NULL AS present`, [tracking])) as { present: boolean }[];
    const applied = await applyPending(tx, tracking, set.table, present[0]?.present === true, set.postgres, 'timestamptz NOT NULL DEFAULT now()');
    return { applied, qualify: (name: string) => `${schema}.${quote(name)}` };
  })) as StoreMigrationResult;
}

async function applySqlite(sql: SQL, set: StoreMigrationSet): Promise<StoreMigrationResult> {
  const tracking = quote(set.table);
  const tracked = async () => ((await sql.unsafe(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = $1`, [set.table])) as unknown[]).length > 0;
  // A fully migrated file is only read, so a warm boot never queues behind a peer's write lock.
  if ((await tracked()) && pendingAfter((await sql.unsafe(`SELECT id, hash FROM ${tracking} ORDER BY id`)) as AppliedRow[], set.sqlite, set.table).length === 0) {
    return { applied: [], qualify: quote };
  }
  // BEGIN IMMEDIATE takes the write lock up front, so concurrent cold boots queue on the busy timeout instead of
  // failing on a lock upgrade, and the loser sees the winner's tracking row.
  await sql.unsafe('BEGIN IMMEDIATE');
  try {
    const applied = await applyPending(sql, tracking, set.table, await tracked(), set.sqlite, `text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    await sql.unsafe('COMMIT');
    return { applied, qualify: quote };
  } catch (err) {
    await sql.unsafe('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Apply a feature's pending migrations on the caller's own client, atomically: either every pending migration and its
 * tracking row commit, or none do. Applied migrations must remain an unchanged prefix of the set (verified by hash).
 */
export function applyStoreMigrations(sql: SQL, type: 'sqlite' | 'postgres', set: StoreMigrationSet, opts: StoreMigrationOptions = {}): Promise<StoreMigrationResult> {
  if (!TABLE_NAME_PATTERN.test(set.table)) {
    throw new Error(`applyStoreMigrations({ table }): "${set.table}" is not a valid table name.`);
  }
  return type === 'sqlite' ? applySqlite(sql, set) : applyPostgres(sql, set, opts);
}
