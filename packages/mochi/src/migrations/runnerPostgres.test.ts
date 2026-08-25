import { describe, expect, test, beforeAll, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';
import { runMigrations as migrate } from './runner';

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-migrate-pg-'));
let pg: TestPostgres;
let dir: string;
let n = 0;

beforeAll(async () => {
  pg = await startTestPostgres();
});

beforeEach(async () => {
  dir = path.join(root, `case-${n++}`);
  mkdirSync(dir, { recursive: true });
  await pg.query('DROP SCHEMA public CASCADE');
  await pg.query('CREATE SCHEMA public');
});

afterAll(async () => {
  await pg?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('runMigrations (postgres)', () => {
  test('applies pending migrations in order, records them, and is idempotent', async () => {
    writeFileSync(path.join(dir, '1_users.sql'), 'CREATE TABLE users (id integer PRIMARY KEY, name text NOT NULL);');
    writeFileSync(path.join(dir, '2_seed.sql'), "INSERT INTO users (id, name) VALUES (1, 'ada');");
    const applied = await migrate({ storage: { type: 'postgres', url: pg.url }, dir });
    expect(applied.map((m) => m.filename)).toEqual(['1_users.sql', '2_seed.sql']);

    const tracked = await pg.query<{ id: number; name: string; hash: string }>('SELECT id, name, hash FROM migrations ORDER BY id');
    expect(tracked.rows.map((r) => [r.id, r.name])).toEqual([
      [1, 'users'],
      [2, 'seed'],
    ]);
    expect(tracked.rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await pg.query<{ name: string }>('SELECT name FROM users')).rows[0]!.name).toBe('ada');

    expect(await migrate({ storage: { type: 'postgres', url: pg.url }, dir })).toEqual([]);
  });

  test('an edited applied migration is rejected as immutable', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await migrate({ storage: { type: 'postgres', url: pg.url }, dir });
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer, y integer);');
    await expect(migrate({ storage: { type: 'postgres', url: pg.url }, dir })).rejects.toThrow(/changed since it was applied.*immutable/);
  });

  test('a failing migration rolls back its statements and is not recorded; earlier ones stay', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_bad.sql'), 'INSERT INTO a (x) VALUES (1); INSERT INTO nope (z) VALUES (1);');
    await expect(migrate({ storage: { type: 'postgres', url: pg.url }, dir })).rejects.toThrow(/nope/);

    expect((await pg.query<{ id: number }>('SELECT id FROM migrations')).rows.map((r) => r.id)).toEqual([1]);
    expect((await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM a')).rows[0]!.n).toBe(0);
  });

  test('framework and app tracking tables coexist in one database', async () => {
    writeFileSync(path.join(dir, '1_fw.sql'), 'CREATE TABLE fw (x integer);');
    const appDir = path.join(root, `case-${n++}`);
    mkdirSync(appDir);
    writeFileSync(path.join(appDir, '1_app.sql'), 'CREATE TABLE app (x integer);');

    await migrate({ storage: { type: 'postgres', url: pg.url }, dir, table: 'mochi_migrations', label: 'mochi' });
    await migrate({ storage: { type: 'postgres', url: pg.url }, dir: appDir, label: 'app' });

    expect((await pg.query<{ name: string }>('SELECT name FROM mochi_migrations')).rows.map((r) => r.name)).toEqual(['fw']);
    expect((await pg.query<{ name: string }>('SELECT name FROM migrations')).rows.map((r) => r.name)).toEqual(['app']);
  });

  // True two-client concurrency can't run here — PGlite's socket server serves one connection at a time — but
  // every run above exercises pg_advisory_lock; this asserts the whole-run lock is released afterwards.
  test('the advisory lock is released once the run completes', async () => {
    writeFileSync(path.join(dir, '1_t.sql'), 'CREATE TABLE t (x integer);');
    await migrate({ storage: { type: 'postgres', url: pg.url }, dir });
    const locks = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'");
    expect(locks.rows[0]!.n).toBe(0);
  });
});
