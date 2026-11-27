import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { applyStoreMigrations, type StoreMigrationSet } from './storeMigrations';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-storemig-'));
const clients: SQL[] = [];
let pg: TestPostgres;

const one = { id: 1, name: 'things', sql: 'CREATE TABLE things (id integer PRIMARY KEY);\nCREATE INDEX things_idx ON things (id);' };
const two = { id: 2, name: 'more', sql: 'CREATE TABLE more_things (id integer PRIMARY KEY);' };
const broken = { id: 2, name: 'broken', sql: 'CREATE TABLE more_things (id integer PRIMARY KEY); CREATE TABLE things (id integer);' };
const setOf = (...migrations: (typeof one)[]): StoreMigrationSet => ({ table: 'mochi_migrations_things', sqlite: migrations, postgres: migrations });

function sqlite(name: string): SQL {
  const sql = new SQL({ adapter: 'sqlite', filename: path.join(root, name) });
  clients.push(sql);
  return sql;
}

// Records every statement and whether it ran inside the transaction, to pin down what reaches a pooler.
function recording(sql: SQL): { sql: SQL; log: string[] } {
  const log: string[] = [];
  let inTransaction = false;
  const wrap = (target: SQL): SQL =>
    new Proxy(target, {
      get(t, prop) {
        if (prop === 'unsafe') {
          return (text: string, params?: unknown[]) => {
            log.push(`${inTransaction ? 'tx' : 'top'}: ${text}`);
            return t.unsafe(text, params as never[]);
          };
        }
        if (prop === 'begin') {
          return (fn: (tx: SQL) => Promise<unknown>) => {
            log.push('begin');
            return t.begin(async (tx) => {
              inTransaction = true;
              try {
                return await fn(wrap(tx));
              } finally {
                inTransaction = false;
                log.push('end');
              }
            });
          };
        }
        const value = Reflect.get(t, prop, t);
        return typeof value === 'function' ? value.bind(t) : value;
      },
    });
  return { sql: wrap(sql), log };
}

beforeAll(async () => {
  pg = await startTestPostgres({ maxConnections: Infinity });
});

afterEach(async () => {
  for (const sql of clients) {
    await sql.close();
  }
  clients.length = 0;
  await pg.query('DROP SCHEMA IF EXISTS store_app CASCADE');
  await pg.query('DROP SCHEMA public CASCADE');
  await pg.query('CREATE SCHEMA public');
  await pg.query('RESET search_path');
});

afterAll(async () => {
  await pg?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('applyStoreMigrations (sqlite)', () => {
  test('applies pending migrations once and tracks them in the set table', async () => {
    const sql = sqlite('apply.sqlite');
    const first = await applyStoreMigrations(sql, 'sqlite', setOf(one));
    expect(first.applied.map((m) => m.id)).toEqual([1]);
    expect(first.qualify('things')).toBe('"things"');

    expect((await applyStoreMigrations(sql, 'sqlite', setOf(one))).applied).toEqual([]);
    expect((await applyStoreMigrations(sql, 'sqlite', setOf(one, two))).applied.map((m) => m.id)).toEqual([2]);

    const tracked = (await sql.unsafe('SELECT id, name FROM mochi_migrations_things ORDER BY id')) as { id: number; name: string }[];
    expect(tracked.map((row) => ({ ...row }))).toEqual([
      { id: 1, name: 'things' },
      { id: 2, name: 'more' },
    ]);
  });

  test('a failing migration rolls the whole run back, including the migrations before it', async () => {
    const sql = sqlite('atomic.sqlite');
    await expect(applyStoreMigrations(sql, 'sqlite', setOf(one, broken))).rejects.toThrow(/already exists/);
    const tables = (await sql.unsafe("SELECT name FROM sqlite_master WHERE type = 'table'")) as { name: string }[];
    expect(tables).toHaveLength(0);
    expect((await applyStoreMigrations(sql, 'sqlite', setOf(one, two))).applied.map((m) => m.id)).toEqual([1, 2]);
  });

  test('an up-to-date database is only read, so it never waits for the write lock', async () => {
    const file = path.join(root, 'warm.sqlite');
    const sql = sqlite('warm.sqlite');
    await sql.unsafe('PRAGMA journal_mode = WAL');
    await applyStoreMigrations(sql, 'sqlite', setOf(one));

    const holder = new SQL({ adapter: 'sqlite', filename: file });
    clients.push(holder);
    await holder.unsafe('BEGIN IMMEDIATE');
    // With the lock held by another connection, a write-locking run would fail at once (busy_timeout is 0 here).
    expect((await applyStoreMigrations(sql, 'sqlite', setOf(one))).applied).toEqual([]);
    await expect(applyStoreMigrations(sql, 'sqlite', setOf(one, two))).rejects.toThrow(/locked/);
    await holder.unsafe('ROLLBACK');
  });

  test('refuses a database migrated by a newer version or with a different migration', async () => {
    const sql = sqlite('skew.sqlite');
    await applyStoreMigrations(sql, 'sqlite', setOf(one, two));
    await expect(applyStoreMigrations(sql, 'sqlite', setOf(one))).rejects.toThrow(/migrated by a newer version/);
    await expect(applyStoreMigrations(sql, 'sqlite', setOf({ ...one, sql: `${one.sql}\n-- edited` }, two))).rejects.toThrow(
      /differs from the one this mochi-framework version ships/,
    );
    expect(() => applyStoreMigrations(sql, 'sqlite', { ...setOf(one), table: 'bad name;' })).toThrow(/not a valid table name/);
  });
});

describe('applyStoreMigrations (postgres)', () => {
  function postgres(): SQL {
    const sql = new SQL({ adapter: 'postgres', url: pg.url, max: 2, prepare: false });
    clients.push(sql);
    return sql;
  }

  test('runs as one transaction under a transaction-scoped advisory lock, with no session lock or setting left behind', async () => {
    const searchPath = async () => (await pg.query<{ search_path: string }>('SHOW search_path')).rows[0]!.search_path;
    const before = await searchPath();
    const { sql, log } = recording(postgres());
    const result = await applyStoreMigrations(sql, 'postgres', setOf(one, two), { lockTimeoutMs: 5_000 });
    expect(result.applied.map((m) => m.id)).toEqual([1, 2]);

    expect(log[0]).toBe('begin');
    expect(log.at(-1)).toBe('end');
    expect(log.slice(1, -1).every((entry) => entry.startsWith('tx: '))).toBe(true);
    expect(log.some((entry) => entry.includes('pg_advisory_xact_lock('))).toBe(true);
    expect(log.some((entry) => /pg_advisory_(lock|unlock)\(/.test(entry))).toBe(false);
    expect(log.filter((entry) => /\bSET\b/.test(entry)).every((entry) => entry.includes('SET LOCAL'))).toBe(true);

    expect((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0]!.n).toBe(0);
    expect((await pg.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0]!.lock_timeout).toBe('0');
    expect(await searchPath()).toBe(before);
  });

  test('an up-to-date database is only read', async () => {
    await applyStoreMigrations(postgres(), 'postgres', setOf(one));
    const { sql, log } = recording(postgres());
    expect((await applyStoreMigrations(sql, 'postgres', setOf(one))).applied).toEqual([]);
    expect(log.some((entry) => /CREATE|INSERT/.test(entry))).toBe(false);
  });

  // Skipped on Windows: an aborted transaction stalls @electric-sql/pglite-socket's query queue there (see
  // scripts/run-tests.ts on runnerPostgres.test.ts); the sqlite case above covers the same rollback logic everywhere.
  test.skipIf(process.platform === 'win32')('a failing migration leaves nothing of the run behind', async () => {
    await applyStoreMigrations(postgres(), 'postgres', setOf(one));
    await expect(applyStoreMigrations(postgres(), 'postgres', setOf(one, broken))).rejects.toThrow(/already exists/);
    const tables = await pg.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    expect(tables.rows.map((row) => row.tablename)).toEqual(['mochi_migrations_things', 'things']);
    expect((await pg.query<{ id: number }>('SELECT id FROM mochi_migrations_things')).rows).toEqual([{ id: 1 }]);
  });

  test('creates everything in the current schema and returns identifiers pinned to it', async () => {
    await pg.query('CREATE SCHEMA store_app');
    await pg.query('SET search_path TO store_app');
    const result = await applyStoreMigrations(postgres(), 'postgres', setOf(one));
    await pg.query('RESET search_path');

    expect(result.qualify('things')).toBe('"store_app"."things"');
    const tables = await pg.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'store_app' ORDER BY tablename`);
    expect(tables.rows.map((row) => row.tablename)).toEqual(['mochi_migrations_things', 'things']);
    expect((await pg.query(`SELECT 1 FROM pg_tables WHERE schemaname = 'public'`)).rows).toEqual([]);
  });
});
