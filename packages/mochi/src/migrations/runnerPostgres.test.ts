import { describe, expect, test, beforeAll, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';
import { startStartupCapture } from '../__fixtures__/postgres/tcpProxy';
import { runMigrations as migrate } from './runner';

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-migrate-pg-'));
let pg: TestPostgres;
let dir: string;
let n = 0;

beforeAll(async () => {
  pg = await startTestPostgres({ maxConnections: Infinity });
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
  test('applies pending migrations in order into mochi_migrations, records them, and is idempotent', async () => {
    writeFileSync(path.join(dir, '1_users.sql'), 'CREATE TABLE users (id integer PRIMARY KEY, name text NOT NULL);');
    writeFileSync(path.join(dir, '2_seed.sql'), "INSERT INTO users (id, name) VALUES (1, 'ada');");
    const applied = await migrate({ storage: { type: 'postgres', url: pg.url }, dir });
    expect(applied.map((m) => m.filename)).toEqual(['1_users.sql', '2_seed.sql']);

    const tracked = await pg.query<{ id: number; name: string; hash: string }>('SELECT id, name, hash FROM mochi_migrations ORDER BY id');
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

    expect((await pg.query<{ id: number }>('SELECT id FROM mochi_migrations')).rows.map((r) => r.id)).toEqual([1]);
    expect((await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM a')).rows[0]!.n).toBe(0);
  }, 15_000);

  test('rejects explicit BEGIN, COMMIT, or ROLLBACK while allowing dollar-quoted blocks and savepoints', async () => {
    writeFileSync(path.join(dir, '1_sneaky.sql'), 'CREATE TABLE sneaky (x integer); ROLLBACK;');
    await expect(migrate({ storage: { type: 'postgres', url: pg.url }, dir })).rejects.toThrow(/explicit "ROLLBACK" statement/);
    expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sneaky'")).rows[0]!.n).toBe(0);

    writeFileSync(
      path.join(dir, '1_sneaky.sql'),
      `CREATE TABLE items (id integer PRIMARY KEY);
       DO $$
       BEGIN
         INSERT INTO items (id) VALUES (1);
       END
       $$;
       SAVEPOINT sp;
       INSERT INTO items (id) VALUES (2);
       ROLLBACK TO sp;`,
    );
    const applied = await migrate({ storage: { type: 'postgres', url: pg.url }, dir });
    expect(applied.map((m) => m.id)).toEqual([1]);
    expect((await pg.query<{ id: number }>('SELECT id FROM items')).rows.map((r) => r.id)).toEqual([1]);
  });

  test('framework and app tracking tables coexist in one database', async () => {
    writeFileSync(path.join(dir, '1_fw.sql'), 'CREATE TABLE fw (x integer);');
    const appDir = path.join(root, `case-${n++}`);
    mkdirSync(appDir);
    writeFileSync(path.join(appDir, '1_app.sql'), 'CREATE TABLE app (x integer);');

    await migrate({ storage: { type: 'postgres', url: pg.url }, dir, table: 'mochi_migrations_internal', label: 'mochi' });
    await migrate({ storage: { type: 'postgres', url: pg.url }, dir: appDir, label: 'app' });

    expect((await pg.query<{ name: string }>('SELECT name FROM mochi_migrations_internal')).rows.map((r) => r.name)).toEqual(['fw']);
    expect((await pg.query<{ name: string }>('SELECT name FROM mochi_migrations')).rows.map((r) => r.name)).toEqual(['app']);
  });

  test('keeps tracking writes in the initial schema and resets SET search_path before later files', async () => {
    writeFileSync(path.join(dir, '1_schema.sql'), 'CREATE SCHEMA app_s; SET search_path TO app_s; CREATE TABLE items (id integer PRIMARY KEY);');
    writeFileSync(path.join(dir, '2_default_schema.sql'), 'CREATE TABLE default_items (id integer PRIMARY KEY);');
    try {
      const applied = await migrate({ storage: { type: 'postgres', url: pg.url }, dir });
      expect(applied.map((m) => m.id)).toEqual([1, 2]);
      expect((await pg.query<{ id: number }>('SELECT id FROM public.mochi_migrations ORDER BY id')).rows.map((r) => r.id)).toEqual([1, 2]);
      expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app_s' AND tablename = 'items'")).rows[0]!.n).toBe(1);
      // File 2 must land in `public` just as it would on an incremental deploy where file 1 had already run earlier.
      expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'default_items'")).rows[0]!.n).toBe(1);
    } finally {
      await pg.query('DROP SCHEMA IF EXISTS app_s CASCADE');
    }
  });

  test('resets SET ROLE before later files, so a file runs as the same role on a fresh and an incremental deploy', async () => {
    await pg.query('DROP ROLE IF EXISTS mig_owner');
    await pg.query('CREATE ROLE mig_owner');
    await pg.query('GRANT ALL ON SCHEMA public TO mig_owner');
    // The tracking table is created before file 1 switches role, and file 1's own tracking row is written after it.
    await pg.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mig_owner');
    writeFileSync(path.join(dir, '1_as_owner.sql'), 'SET ROLE mig_owner; CREATE TABLE owned (id integer);');
    writeFileSync(path.join(dir, '2_plain.sql'), 'CREATE TABLE plain (id integer);');
    try {
      const login = (await pg.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u;
      const applied = await migrate({ storage: { type: 'postgres', url: pg.url }, dir });
      expect(applied.map((m) => m.id)).toEqual([1, 2]);
      const owners = await pg.query<{ tablename: string; tableowner: string }>(
        "SELECT tablename, tableowner FROM pg_tables WHERE tablename IN ('owned', 'plain') ORDER BY tablename",
      );
      expect(owners.rows).toEqual([
        { tablename: 'owned', tableowner: 'mig_owner' },
        { tablename: 'plain', tableowner: login },
      ]);
      expect((await pg.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u).toBe(login);
    } finally {
      // PGlite shares one backend session across sockets, so a role left set would leak into the following tests.
      await pg.query('RESET ROLE');
      await pg.query('DROP OWNED BY mig_owner');
      await pg.query('DROP ROLE mig_owner');
    }
  });

  test('connects to the database named in the URL even when PGDATABASE names another', async () => {
    writeFileSync(path.join(dir, '1_t.sql'), 'CREATE TABLE t (x integer);');
    const capture = startStartupCapture();
    const previous = process.env.PGDATABASE;
    process.env.PGDATABASE = 'from_env';
    try {
      await expect(migrate({ storage: { type: 'postgres', url: `postgres://mig_user:pw@127.0.0.1:${capture.port}/from_url` }, dir })).rejects.toThrow();
      expect(capture.startups[0]).toMatchObject({ user: 'mig_user', database: 'from_url' });
    } finally {
      if (previous === undefined) {
        delete process.env.PGDATABASE;
      } else {
        process.env.PGDATABASE = previous;
      }
      capture.close();
    }
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
