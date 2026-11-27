import { describe, expect, test, beforeEach, afterAll, spyOn } from 'bun:test';
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

async function rows(query: string, targetDb = db): Promise<Record<string, unknown>[]> {
  const sql = new SQL({ adapter: 'sqlite', filename: targetDb });
  try {
    return (await sql.unsafe(query)) as Record<string, unknown>[];
  } finally {
    await sql.close();
  }
}

describe('runMigrations (sqlite)', () => {
  test('rejects an invalid storage option before opening any connection', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await expect(runMigrations({ storage: { sqlite: db } as never, dir })).rejects.toThrow(/runMigrations\(\{ storage \}\): expected/);
    expect(existsSync(db)).toBe(false);
  });

  test('applies pending migrations in order into mochi_migrations, records them, and is idempotent', async () => {
    writeFileSync(path.join(dir, '1_users.sql'), 'CREATE TABLE users (id integer PRIMARY KEY, name text);');
    writeFileSync(path.join(dir, '2_seed.sql'), "INSERT INTO users (id, name) VALUES (1, 'ada');");
    const applied = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(applied.map((m) => m.filename)).toEqual(['1_users.sql', '2_seed.sql']);

    const tracked = await rows('SELECT id, name, hash, applied_at FROM mochi_migrations ORDER BY id');
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

  test('records comment-only and empty placeholder files without throwing', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_pg_only.sql'), '-- Postgres-only migration; no-op on SQLite\n');
    writeFileSync(path.join(dir, '3_empty.sql'), '');
    const applied = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(applied.map((m) => m.id)).toEqual([1, 2, 3]);
    expect((await rows('SELECT id FROM mochi_migrations ORDER BY id')).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  test('handles SQLite file paths containing #, %20, and spaces literally', async () => {
    const specialDb = path.join(root, `dir#hash %20-${n++}`, 'app.db');
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await runMigrations({ storage: { type: 'sqlite', path: specialDb }, dir });
    expect(existsSync(specialDb)).toBe(true);
    expect((await rows('SELECT id FROM mochi_migrations', specialDb)).map((r) => r.id)).toEqual([1]);
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

  test('with tolerateHistoryMismatch, a database migrated by a newer release warns and boots', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_b.sql'), 'CREATE TABLE b (y integer);');
    await runMigrations({ storage: { type: 'sqlite', path: db }, dir, label: 'mochi' });
    rmSync(path.join(dir, '2_b.sql'));
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await runMigrations({ storage: { type: 'sqlite', path: db }, dir, label: 'mochi', tolerateHistoryMismatch: true })).toEqual([]);
      const logged = warn.mock.calls.flat().join(' ');
      expect(logged).toContain('Database mochi migration is at version 2 ("b") but you are booting an older version');
      expect(logged).toMatch(/\(mochi-framework \d+\.\d+\.\d+[^,]*, which knows mochi migrations up to 1\)/);
      expect(logged).toContain('Some features might not work correctly.');
    } finally {
      warn.mockRestore();
    }
  });

  test('with tolerateHistoryMismatch, a changed applied migration warns and applies nothing after it', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await runMigrations({ storage: { type: 'sqlite', path: db }, dir, label: 'mochi' });
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer, y integer);');
    writeFileSync(path.join(dir, '2_b.sql'), 'CREATE TABLE b (y integer);');
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await runMigrations({ storage: { type: 'sqlite', path: db }, dir, label: 'mochi', tolerateHistoryMismatch: true })).toEqual([]);
      expect(warn.mock.calls.flat().join(' ')).toContain('Database mochi migration 1 ("a") does not match the "1_a.sql"');
    } finally {
      warn.mockRestore();
    }
    expect(await rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'b'")).toEqual([]);
  });

  test('a failing migration rolls back its statements and is not recorded; earlier ones stay', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_bad.sql'), 'INSERT INTO a (x) VALUES (1); INSERT INTO nope (z) VALUES (1);');
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir })).rejects.toThrow(/no such table/);

    expect((await rows('SELECT id FROM mochi_migrations')).map((r) => r.id)).toEqual([1]);
    expect((await rows('SELECT count(*) AS n FROM a'))[0]!.n).toBe(0);

    // Fixing the file lets the run complete from where it left off.
    writeFileSync(path.join(dir, '2_bad.sql'), 'INSERT INTO a (x) VALUES (1);');
    const applied = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(applied.map((m) => m.id)).toEqual([2]);
  });

  test('applies zero-prefixed migrations (001..010) in order and stays idempotent on incremental runs', async () => {
    writeFileSync(path.join(dir, '001-log.sql'), 'CREATE TABLE seq_log (step integer NOT NULL);');
    for (let i = 2; i <= 10; i++) {
      writeFileSync(path.join(dir, `${String(i).padStart(3, '0')}-step-${i}.sql`), `INSERT INTO seq_log (step) VALUES (${i});`);
    }
    const firstRun = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(firstRun.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(firstRun[0]!.filename).toBe('001-log.sql');
    expect(firstRun[9]!.filename).toBe('010-step-10.sql');
    expect((await rows('SELECT step FROM seq_log')).map((r) => r.step)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);

    expect(await runMigrations({ storage: { type: 'sqlite', path: db }, dir })).toEqual([]);
    writeFileSync(path.join(dir, '011-step-11.sql'), 'INSERT INTO seq_log (step) VALUES (11);');
    const nextRun = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(nextRun).toEqual([{ id: 11, filename: '011-step-11.sql' }]);
  });

  test('rejects explicit BEGIN, COMMIT, or ROLLBACK before opening the database while allowing triggers and savepoints', async () => {
    writeFileSync(path.join(dir, '1_sneaky.sql'), 'CREATE TABLE sneaky (x integer); COMMIT;');
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir })).rejects.toThrow(/explicit "COMMIT" statement/);
    expect(existsSync(db)).toBe(false);

    writeFileSync(
      path.join(dir, '1_sneaky.sql'),
      `CREATE TABLE items (id integer PRIMARY KEY, label text);
       CREATE TABLE audit (item_id integer);
       CREATE TRIGGER tr_items AFTER INSERT ON items BEGIN
         INSERT INTO audit (item_id) VALUES (NEW.id);
       END;
       SAVEPOINT sp;
       INSERT INTO items (id, label) VALUES (99, 'temp');
       ROLLBACK TO sp;
       RELEASE sp;
       INSERT INTO items (id, label) VALUES (1, 'kept');`,
    );
    const applied = await runMigrations({ storage: { type: 'sqlite', path: db }, dir });
    expect(applied.map((m) => m.id)).toEqual([1]);
    expect((await rows('SELECT id FROM items')).map((r) => r.id)).toEqual([1]);
    expect((await rows('SELECT item_id FROM audit')).map((r) => r.item_id)).toEqual([1]);
  });

  test('a no-transaction migration runs unwrapped, so pre-failure statements persist', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    writeFileSync(path.join(dir, '2_no_tx.sql'), '-- migrate:no-transaction\nINSERT INTO a (x) VALUES (7); INSERT INTO nope (z) VALUES (1);');
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir })).rejects.toThrow(/no such table/);
    expect((await rows('SELECT count(*) AS n FROM a WHERE x = 7'))[0]!.n).toBe(1);
    expect((await rows('SELECT id FROM mochi_migrations')).map((r) => r.id)).toEqual([1]);
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
    expect((await rows('SELECT id FROM mochi_migrations')).map((r) => r.id)).toEqual([1, 2]);
  });

  test('two racing OS processes on an idempotent no-transaction migration both succeed cleanly', async () => {
    writeFileSync(
      path.join(dir, '1_notx.sql'),
      '-- migrate:no-transaction\nCREATE TABLE IF NOT EXISTS idx_t (x integer);\nWITH RECURSIVE r(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM r WHERE n < 400000) SELECT sum(n) FROM r;',
    );
    const runnerPath = path.join(import.meta.dir, 'runner.ts');
    const childCode = `import { runMigrations } from ${JSON.stringify(runnerPath)}; await runMigrations({ storage: { type: 'sqlite', path: ${JSON.stringify(db)} }, dir: ${JSON.stringify(dir)} });`;
    const p1 = Bun.spawn([process.execPath, '-e', childCode], { stdout: 'ignore', stderr: 'pipe' });
    const p2 = Bun.spawn([process.execPath, '-e', childCode], { stdout: 'ignore', stderr: 'pipe' });
    const [c1, c2] = await Promise.all([p1.exited, p2.exited]);
    expect([c1, c2]).toEqual([0, 0]);
    expect((await rows('SELECT id FROM mochi_migrations')).map((r) => r.id)).toEqual([1]);
  });

  test('a custom tracking table is honored and validated', async () => {
    writeFileSync(path.join(dir, '1_a.sql'), 'CREATE TABLE a (x integer);');
    await runMigrations({ storage: { type: 'sqlite', path: db }, dir, table: 'custom_migrations' });
    expect((await rows('SELECT id FROM custom_migrations')).map((r) => r.id)).toEqual([1]);
    await expect(runMigrations({ storage: { type: 'sqlite', path: db }, dir, table: 'bad"name' })).rejects.toThrow(/not a valid table name/);
  });
});
