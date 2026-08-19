import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import { SQL } from 'bun';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runMigrations } from './runner';

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-migrate-sqlite-'));
let dir: string;
let db: string;
let n = 0;

beforeEach(() => {
  dir = path.join(root, `case-${n}`);
  db = path.join(root, `case-${n}.db`);
  n++;
  mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function rows(query: string): Promise<Record<string, unknown>[]> {
  const sql = new SQL(`sqlite://${db}`);
  try {
    return (await sql.unsafe(query)) as Record<string, unknown>[];
  } finally {
    await sql.close();
  }
}

describe('runMigrations (sqlite)', () => {
  test('applies pending migrations in order, records them, and is idempotent', async () => {
    writeFileSync(path.join(dir, '1_users.sql'), 'CREATE TABLE users (id integer PRIMARY KEY, name text);');
    writeFileSync(path.join(dir, '2_seed.sql'), "INSERT INTO users (id, name) VALUES (1, 'ada');");
    const applied = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(applied.map((m) => m.filename)).toEqual(['1_users.sql', '2_seed.sql']);

    const tracked = await rows('SELECT id, name, hash, applied_at FROM migrations ORDER BY id');
    expect(tracked.map((r) => [r.id, r.name])).toEqual([
      [1, 'users'],
      [2, 'seed'],
    ]);
    expect(String(tracked[0]!.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(tracked[0]!.applied_at).length).toBeGreaterThan(0);
    expect((await rows('SELECT name FROM users'))[0]!.name).toBe('ada');

    expect(await runMigrations({ storage: { type: 'sqlite', path: db }, dir })).toEqual([]);
  });

  test('applies only migrations beyond the applied prefix', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    writeFileSync(path.join(dir, '2_b.sql'), 'CREATE TABLE b (y integer);');
    const applied = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(applied.map((m) => m.id)).toEqual([2]);
  });

  test('an edited applied migration is rejected as immutable', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer, y integer);');
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir })).rejects.toThrow(/changed since it was applied.*immutable/);
  });

  test('fewer files than applied migrations is rejected', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_b.sql'), 'CREATE TABLE b (y integer);');
    await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    rmSync(path.join(dir, '2_b.sql'));
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir })).rejects.toThrow(/2 applied migration\(s\) but only 1 file\(s\)/);
  });

  test('a failing migration rolls back its statements and is not recorded; earlier ones stay', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_bad.sql'), 'INSERT INTO a (x) VALUES (1); INSERT INTO nope (z) VALUES (1);');
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir })).rejects.toThrow(/no such table/);

    expect((await rows('SELECT id FROM migrations')).map((r) => r.id)).toEqual([1]);
    expect((await rows('SELECT count(*) AS n FROM a'))[0]!.n).toBe(0);

    // Fixing the file lets the run complete from where it left off.
    writeFileSync(path.join(dir, '2_bad.sql'), 'INSERT INTO a (x) VALUES (1);');
    const applied = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(applied.map((m) => m.id)).toEqual([2]);
  });

  test('a no-transaction migration runs unwrapped, so pre-failure statements persist', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_no_tx.sql'), '-- migrate:no-transaction\nINSERT INTO a (x) VALUES (7); INSERT INTO nope (z) VALUES (1);');
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir })).rejects.toThrow(/no such table/);
    expect((await rows('SELECT count(*) AS n FROM a WHERE x = 7'))[0]!.n).toBe(1);
    expect((await rows('SELECT id FROM migrations')).map((r) => r.id)).toEqual([1]);
  });

  test('an empty or missing dir touches nothing — not even the database file', async () => {
    expect(await runMigrations({ storage: { type: 'sqlite', path: db }, dir })).toEqual([]);
    expect(await runMigrations({ storage: { type: 'sqlite', path: db }, dir: path.join(dir, 'missing') })).toEqual([]);
    expect(existsSync(db)).toBe(false);
  });

  test('concurrent runners each apply every migration exactly once', async () => {
    writeFileSync(path.join(dir, '1_t.sql'), 'CREATE TABLE t (x integer); INSERT INTO t (x) VALUES (1);');
    writeFileSync(path.join(dir, '2_u.sql'), 'CREATE TABLE u (y integer);');
    const run = () => runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    const results = await Promise.all([run(), run(), run()]);
    expect(
      results
        .flat()
        .map((m) => m.id)
        .sort(),
    ).toEqual([1, 2]);
    expect((await rows('SELECT count(*) AS n FROM t'))[0]!.n).toBe(1);
    expect((await rows('SELECT id FROM migrations')).map((r) => r.id)).toEqual([1, 2]);
  });

  test('a custom tracking table is honored and validated', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await runMigrations({ storage: { type: 'sqlite', path: db }, dir, table: 'mochi_migrations' });
    expect((await rows('SELECT id FROM mochi_migrations')).map((r) => r.id)).toEqual([1]);
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir, table: 'bad"name' })).rejects.toThrow(/not a valid table name/);
  });
});
