import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MochiCache } from './cache';
import { FileStorage, PostgresStorage, isBlobRef } from './cache-storage';
import { sqlBackendStats, sqlCacheTuning } from './sql-backend';
import { sweepBatchSql } from './sql-storage';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';
import { startStartupCapture, startTcpProxy, type TcpProxy } from '../__fixtures__/postgres/tcpProxy';
import { mochiEvents } from '../events';
import { runMigrations } from '../migrations/runner';
import { runStartupMigrations } from '../migrations/startup';

const wait = Bun.sleep;

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-pgcache-'));
const tuningDefaults = { ...sqlCacheTuning };
let pg: TestPostgres;
const created: PostgresStorage[] = [];
const proxies: TcpProxy[] = [];

beforeAll(async () => {
  pg = await startTestPostgres({ maxConnections: Infinity });
});

beforeEach(async () => {
  await pg.query('DROP SCHEMA IF EXISTS custom_app CASCADE');
  await pg.query('DROP SCHEMA IF EXISTS app_a CASCADE');
  await pg.query('DROP SCHEMA IF EXISTS app_b CASCADE');
  await pg.query('DROP SCHEMA public CASCADE');
  await pg.query('CREATE SCHEMA public');
});

afterEach(async () => {
  mochiEvents.all.clear();
  Object.assign(sqlCacheTuning, tuningDefaults);
  for (const proxy of proxies) {
    proxy.stall(false);
  }
  for (const storage of created) {
    await storage.dispose();
  }
  created.length = 0;
  for (const proxy of proxies) {
    proxy.close();
  }
  proxies.length = 0;
  // PGlite shares one backend session across every socket, so session state a test set would leak into the next one.
  await pg.query('RESET ROLE');
  await pg.query('RESET search_path');
});

afterAll(async () => {
  await pg?.close();
  rmSync(root, { recursive: true, force: true });
});

function makeStorage(options: Partial<ConstructorParameters<typeof PostgresStorage>[0]> = {}): PostgresStorage {
  const storage = new PostgresStorage({ url: pg.url, purgeInterval: 0, ...options });
  created.push(storage);
  return storage;
}

function makeProxy(): { proxy: TcpProxy; url: string } {
  const proxy = startTcpProxy(pg.port);
  proxies.push(proxy);
  return { proxy, url: `postgres://postgres:postgres@127.0.0.1:${proxy.port}/postgres` };
}

async function tablesIn(schema: string): Promise<string[]> {
  const result = await pg.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' ORDER BY tablename`);
  return result.rows.map((row) => row.tablename);
}

describe('PostgresStorage validation & core operations', () => {
  test('rejects invalid URLs, namespaces, maxAge, purgeInterval, and unknown options synchronously', async () => {
    expect(() => new PostgresStorage({ url: '' })).toThrow(/PostgresStorage/);
    expect(() => new PostgresStorage({ url: 'mysql://localhost/db' })).toThrow(/PostgresStorage/);
    expect(() => new PostgresStorage({ url: 'postgres://localhost/db\0' })).toThrow(/PostgresStorage/);
    expect(() => new PostgresStorage({ url: pg.url, namespace: '' })).toThrow(/namespace/);
    expect(() => new PostgresStorage({ url: pg.url, namespace: '   ' })).toThrow(/namespace/);
    expect(() => new PostgresStorage({ url: pg.url, maxAge: Number.NaN })).toThrow(/maxAge/);
    expect(() => new PostgresStorage({ url: pg.url, maxAge: 0 })).toThrow(/maxAge/);
    expect(() => new PostgresStorage({ url: pg.url, purgeInterval: Number.NaN })).toThrow(/purgeInterval/);
    expect(() => new PostgresStorage({ url: pg.url, purgeInterval: Number.POSITIVE_INFINITY })).toThrow(/purgeInterval/);
    expect(() => new PostgresStorage({ url: pg.url, extraOption: true } as never)).toThrow(/unknown option "extraOption"/);

    // Trims trailing newline on URLs (common in mounted secret files) and rejects NaN timestamps in sweep().
    const trimmed = makeStorage({ url: `  ${pg.url}\n` });
    await trimmed.setItem('k', { value: 1, createdAt: 0 });
    await expect(trimmed.sweep(Number.NaN)).rejects.toThrow(/finite timestamp/);
    expect(await trimmed.getItem('k')).toEqual({ value: 1, createdAt: 0 });
  });

  test('round-trips get/set/overwrite/remove/clear/count/keys with JS number counts', async () => {
    const storage = makeStorage();

    expect(await storage.getItem('missing')).toBeNull();
    const zero = await storage.count();
    expect(typeof zero).toBe('number');
    expect(zero).toBe(0);
    expect(await storage.keys()).toEqual([]);

    await storage.setItem('a', { value: 1, createdAt: 123 });
    expect(await storage.getItem('a')).toEqual({ value: 1, createdAt: 123 });

    await storage.setItem('a', { value: 99, createdAt: 456 });
    expect(await storage.getItem('a')).toEqual({ value: 99, createdAt: 456 });
    expect(await storage.count()).toBe(1);

    await storage.removeItem('a');
    expect(await storage.getItem('a')).toBeNull();
    await expect(storage.removeItem('nope')).resolves.toBeUndefined();

    await storage.setItem('b', { value: 2, createdAt: 0 });
    await storage.setItem('c', { value: 3, createdAt: 0 });
    const count = await storage.count();
    expect(typeof count).toBe('number');
    expect(count).toBe(2);
    expect((await storage.keys()).sort()).toEqual(['b', 'c']);

    await storage.clear();
    expect(await storage.count()).toBe(0);
  });

  test('handles unicode, SQL-metacharacter keys/namespaces, and nested Uint8Array/Buffer values', async () => {
    const storage = makeStorage({ namespace: `ns'; DROP TABLE mochi_cache CASCADE; --` });
    const key = `pokemon:pikachu/nested?weird=1 ünïcode '; DELETE FROM mochi_cache; --`;
    const bytes = new Uint8Array([10, 20, 30]);
    const buf = Buffer.from([40, 50]);

    await storage.setItem(key, { value: { ok: true, nested: [bytes, buf] }, createdAt: 7 });
    const raw = (await storage.getItem(key)) as { value: { ok: boolean; nested: unknown[] }; createdAt: number };
    expect(raw.value.ok).toBe(true);
    expect(isBlobRef(raw.value.nested[0])).toBe(false);
    expect(raw.value.nested[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(raw.value.nested[0] as Uint8Array)).toEqual([10, 20, 30]);
    expect(Array.from(raw.value.nested[1] as Uint8Array)).toEqual([40, 50]);
    expect(await storage.keys()).toEqual([key]);
  });

  test('keys Postgres cannot index or store as text behave as they do on FileStorage', async () => {
    const file = new FileStorage({ directory: path.join(root, 'odd-keys'), purgeInterval: 0, maxAge: 50 });
    const storage = makeStorage({ maxAge: 50 });
    // Longer than a btree index row (~2.7 KB), a NUL byte, and a lone surrogate.
    const long = Buffer.from(crypto.getRandomValues(new Uint8Array(3000))).toString('base64');
    const keys = [long, 'a\0b', 'a\0c', 'a', 'x\ud800y', ''];
    try {
      for (const backend of [file, storage]) {
        for (const [i, key] of keys.entries()) {
          await backend.setItem(key, { value: i, createdAt: 0 });
        }
      }
      for (const key of keys) {
        expect(await storage.getItem(key)).toEqual(await file.getItem(key));
      }
      expect((await storage.keys()).toSorted()).toEqual((await file.keys()).toSorted());
      expect(await storage.count()).toBe(keys.length);

      await storage.removeItem('a\0b');
      expect(await storage.getItem('a\0b')).toBeNull();
      expect(await storage.getItem('a\0c')).toEqual({ value: 2, createdAt: 0 });

      const swept = await storage.sweep(Date.now() + 1_000, { reportKeys: true });
      expect(swept.removedKeys?.toSorted()).toEqual(keys.filter((key) => key !== 'a\0b').toSorted());
    } finally {
      file.dispose();
    }
  });

  test('a Uint8Array inside a class instance round-trips exactly as on FileStorage', async () => {
    class Asset {
      constructor(
        public name: string,
        public bytes: Uint8Array,
      ) {}
    }
    const file = new FileStorage({ directory: path.join(root, 'class-instances'), purgeInterval: 0 });
    const storage = makeStorage();
    const value = {
      value: { asset: new Asset('logo', new Uint8Array([1, 2, 3])), list: [new Asset('icon', Buffer.from([4, 5]))], when: new Date(0), tags: new Map([['a', 1]]) },
      createdAt: 1,
    };
    try {
      await file.setItem('k', value);
      await storage.setItem('k', value);
      const fromFile = await file.getItem('k');
      const fromPostgres = (await storage.getItem('k')) as { value: { asset: { name: string; bytes: unknown } } };
      expect(fromPostgres.value.asset.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(fromPostgres.value.asset.bytes as Uint8Array)).toEqual([1, 2, 3]);
      expect(fromPostgres).toEqual(fromFile as never);
    } finally {
      file.dispose();
    }
  });

  test('a corrupt JSON row surfaces as a read error and MochiCache degrades to a miss', async () => {
    const storage = makeStorage();
    await storage.setItem('k', { value: 1, createdAt: 0 });
    await pg.query(`UPDATE mochi_cache SET value = '{ not json' WHERE key_json = '"k"'`);
    await expect(storage.getItem('k')).rejects.toThrow(SyntaxError);

    const errors: string[] = [];
    mochiEvents.on('cache:error', (e) => errors.push(e.operation));
    const cache = new MochiCache({ storage });
    let calls = 0;
    expect(await cache.fetch('k', () => ++calls)).toBe(1);
    expect(calls).toBe(1);
    expect(errors).toEqual(['get']);
  });

  test('isolates multiple namespaces across clear, count, keys, purgeOnInit, and sweep', async () => {
    const pokemon = makeStorage({ namespace: 'pokemon', maxAge: 50 });
    const users = makeStorage({ namespace: 'users', maxAge: 60_000 });

    await pokemon.setItem('1', { value: 'bulbasaur', createdAt: 0 });
    await users.setItem('1', { value: 'ada', createdAt: 0 });
    await users.setItem('2', { value: 'grace', createdAt: 0 });

    expect(await pokemon.getItem('1')).toEqual({ value: 'bulbasaur', createdAt: 0 });
    expect(await users.getItem('1')).toEqual({ value: 'ada', createdAt: 0 });
    expect(await pokemon.count()).toBe(1);
    expect(await users.count()).toBe(2);
    expect(await pokemon.keys()).toEqual(['1']);
    expect((await users.keys()).sort()).toEqual(['1', '2']);

    const swept = await pokemon.sweep(Date.now() + 1_000, { reportKeys: true });
    expect(swept).toEqual({ removed: 1, removedKeys: ['1'] });
    expect(await users.count()).toBe(2);

    await pokemon.setItem('25', { value: 'pikachu', createdAt: 0 });
    const resetPokemon = makeStorage({ namespace: 'pokemon', purgeOnInit: true });
    expect(await resetPokemon.getItem('25')).toBeNull();
    expect(await users.getItem('1')).toEqual({ value: 'ada', createdAt: 0 });

    await resetPokemon.setItem('25', { value: 'pikachu', createdAt: 0 });
    await users.clear();
    expect(await users.count()).toBe(0);
    expect(await resetPokemon.getItem('25')).toEqual({ value: 'pikachu', createdAt: 0 });
  });

  test('sweep deletes in bounded batches, yielding between them, and only returns keys on request', async () => {
    sqlCacheTuning.sweepBatchSize = 10;
    const storage = makeStorage({ maxAge: 1_000 });
    await storage.setItem('seed', { value: 0, createdAt: 0 });
    await pg.query(
      `INSERT INTO mochi_cache (namespace, key_hash, key_json, value, written_at) SELECT 'default', 'h' || i, '"old-' || i || '"', '{"__mochiValue":1}', i FROM generate_series(1, 45) i`,
    );

    // Another task sees the table shrink step by step: the delete is several statements, not one.
    const seen = new Set<number>();
    let sweeping = true;
    const observer = (async () => {
      while (sweeping) {
        seen.add(await storage.count());
        await new Promise((done) => setImmediate(done));
      }
    })();
    const quiet = await storage.sweep();
    sweeping = false;
    await observer;
    expect(quiet).toEqual({ removed: 45 });
    expect([...seen].filter((count) => count > 1 && count < 46).length).toBeGreaterThanOrEqual(1);
    expect(await storage.keys()).toEqual(['seed']);

    await pg.query(
      `INSERT INTO mochi_cache (namespace, key_hash, key_json, value, written_at) SELECT 'default', 'h' || i, '"old-' || i || '"', '{"__mochiValue":1}', i FROM generate_series(1, 25) i`,
    );
    const reported = await storage.sweep(Date.now(), { reportKeys: true });
    expect(reported.removed).toBe(25);
    expect(reported.removedKeys?.toSorted()).toEqual(Array.from({ length: 25 }, (_, i) => `old-${i + 1}`).toSorted());
  });

  test('sweeps a large backlog in a namespace the planner statistics do not know yet without rescanning it per batch', async () => {
    const storage = makeStorage({ maxAge: 1_000, namespace: 'backlog' });
    await storage.setItem('seed', { value: 0, createdAt: 0 });
    // Statistics taken while the namespace held one row, then a bulk load: the planner expects next to nothing here, and
    // a delete that leaves it free to walk the namespace once per batch takes minutes instead of milliseconds.
    await pg.query('ANALYZE mochi_cache');
    await pg.query(
      `INSERT INTO mochi_cache (namespace, key_hash, key_json, value, written_at) SELECT 'backlog', 'h' || i, '"old-' || i || '"', '{"__mochiValue":1}', i FROM generate_series(1, 40000) i`,
    );

    const plan = await pg.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN ${sweepBatchSql('postgres', 'mochi_cache', false).replace('$1', "'backlog'").replace('$2', '1000000').replace('$3', '1000').replace('$4', '1000000')}`,
    );
    expect(plan.rows.some((row) => row['QUERY PLAN'].includes('Tid Scan on mochi_cache'))).toBe(true);

    const started = performance.now();
    expect(await storage.sweep()).toEqual({ removed: 40_000 });
    expect(performance.now() - started).toBeLessThan(30_000);
    expect(await storage.keys()).toEqual(['seed']);
  }, 120_000);

  test('background sweeper emits cache:sweep and HMR takeover stops superseded sweepers', async () => {
    let ticks = 0;
    mochiEvents.on('cache:sweep', () => ticks++);

    const first = new PostgresStorage({ url: pg.url, maxAge: 5, purgeInterval: 25 });
    const newest = new PostgresStorage({ url: pg.url, maxAge: 5, purgeInterval: 25 });
    created.push(first, newest);
    await newest.setItem('ephemeral', { value: 1, createdAt: 0 });

    await first.dispose();
    for (let i = 0; i < 200 && ((await newest.getItem('ephemeral')) !== null || ticks === 0); i++) {
      await wait(10);
    }
    expect(await newest.getItem('ephemeral')).toBeNull();
    expect(ticks).toBeGreaterThanOrEqual(1);

    await newest.dispose();
    await wait(50);
    const settled = ticks;
    await wait(150);
    expect(ticks).toBe(settled);
  });
});

describe('MochiCache with PostgresStorage (SWR & multi-replica coalescing)', () => {
  test('supports fresh, stale-while-revalidate, markStale, peek, and cross-process inflight deferral', async () => {
    const storageA = makeStorage();
    const storageB = makeStorage();
    const opts = { minTimeToStale: 20, maxTimeToLive: 10_000, inflightTimeout: 30_000, crossProcessInflight: true } as const;
    const cacheA = new MochiCache({ storage: storageA, ...opts });
    const cacheB = new MochiCache({ storage: storageB, ...opts });

    expect(await cacheA.fetch('k', () => ({ v: 1, bin: new Uint8Array([7, 8]) }))).toEqual({ v: 1, bin: new Uint8Array([7, 8]) });
    await cacheA.markStale('k');
    expect((await cacheB.peek('k'))?.status).toBe('stale');

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inFn = new Promise<void>((r) => (entered = r));
    const aStale = await cacheA.fetchWithStatus('k', async () => {
      entered();
      await gate;
      return { v: 2, bin: new Uint8Array([9]) };
    });
    expect(aStale.status).toBe('stale');
    await inFn;

    let bCalls = 0;
    const bRead = await cacheB.fetchWithStatus('k', () => {
      bCalls++;
      return { v: 99, bin: new Uint8Array([]) };
    });
    expect(bRead.status).toBe('stale');
    expect(bRead.value.v).toBe(1);
    expect(bCalls).toBe(0);

    release();
    await cacheA.whenIdle();
    const refreshed = await cacheB.fetchWithStatus('k', () => ({ v: 99, bin: new Uint8Array([]) }));
    expect(refreshed.status).toBe('fresh');
    expect(refreshed.value).toEqual({ v: 2, bin: new Uint8Array([9]) });
  });
});

describe('PostgresStorage schema', () => {
  test('creates its table and its own tracking table in the current schema on first use, under concurrent cold boot', async () => {
    const stores = Array.from({ length: 6 }, (_, i) => makeStorage({ namespace: `replica-${i % 2}` }));
    await Promise.all(stores.map((s, i) => s.setItem(`k-${i}`, { value: i, createdAt: i })));

    expect(await tablesIn('public')).toEqual(['mochi_cache', 'mochi_migrations_cache']);
    const schemas = await pg.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname = 'mochi_cache'`);
    expect(schemas.rows).toEqual([]);

    const tracked = await pg.query<{ id: number; name: string; hash: string }>('SELECT id, name, hash FROM public.mochi_migrations_cache');
    expect(tracked.rows).toHaveLength(1);
    expect(tracked.rows[0]!.id).toBe(1);
    expect(tracked.rows[0]!.name).toBe('mochi_cache');
    expect(tracked.rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);

    const count = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM public.mochi_cache');
    expect(count.rows[0]!.n).toBe(6);
    const locks = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`);
    expect(locks.rows[0]!.n).toBe(0);
  });

  test('startup migrations for Mochi.serve({ storage }) do not provision the cache', async () => {
    expect(await runStartupMigrations({ type: 'postgres', url: pg.url })).toEqual([]);
    expect(await tablesIn('public')).toEqual([]);
    const schemas = await pg.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname = 'mochi_cache'`);
    expect(schemas.rows).toEqual([]);
  });

  test('works for a role that may create tables in its schema but not schemas in the database', async () => {
    await pg.query('DROP ROLE IF EXISTS cache_app');
    await pg.query('CREATE ROLE cache_app');
    await pg.query('GRANT USAGE, CREATE ON SCHEMA public TO cache_app');
    await pg.query('SET ROLE cache_app');
    await expect(pg.query('CREATE SCHEMA not_allowed')).rejects.toThrow(/permission denied/);

    const storage = makeStorage();
    await storage.setItem('k', { value: 'ok', createdAt: 1 });
    expect(await storage.getItem('k')).toEqual({ value: 'ok', createdAt: 1 });
    await storage.dispose();

    // Once provisioned, a role that cannot create anything still uses it: an up-to-date schema is only read.
    await pg.query('RESET ROLE');
    await pg.query('REVOKE CREATE ON SCHEMA public FROM cache_app');
    await pg.query('SET ROLE cache_app');
    const readOnlyDdl = makeStorage();
    expect(await readOnlyDdl.getItem('k')).toEqual({ value: 'ok', createdAt: 1 });
    await readOnlyDdl.dispose();
    await pg.query('RESET ROLE');
    await pg.query('DROP OWNED BY cache_app');
    await pg.query('DROP ROLE cache_app');
  });

  test('follows search_path, so apps with a schema each get their own cache table', async () => {
    await pg.query('CREATE SCHEMA app_a');
    await pg.query('CREATE SCHEMA app_b');

    await pg.query('SET search_path TO app_a');
    const a = makeStorage();
    await a.setItem('k', { value: 'from a', createdAt: 1 });
    await a.dispose();

    await pg.query('SET search_path TO app_b');
    const b = makeStorage();
    expect(await b.getItem('k')).toBeNull();
    await b.setItem('k', { value: 'from b', createdAt: 1 });
    // The table stays pinned to the schema resolved when the client opened, whatever the session does later.
    await pg.query('SET search_path TO app_a');
    expect(await b.getItem('k')).toEqual({ value: 'from b', createdAt: 1 });
    await b.dispose();
    await pg.query('RESET search_path');

    expect(await tablesIn('app_a')).toEqual(['mochi_cache', 'mochi_migrations_cache']);
    expect(await tablesIn('app_b')).toEqual(['mochi_cache', 'mochi_migrations_cache']);
    expect(await tablesIn('public')).toEqual([]);
    expect((await pg.query<{ value: string }>('SELECT value FROM app_a.mochi_cache')).rows[0]!.value).toContain('from a');
  });

  test('works alongside user migrations that alter search_path', async () => {
    const migDir = path.join(root, 'app-migrations');
    mkdirSync(migDir, { recursive: true });
    writeFileSync(path.join(migDir, '1_custom_schema.sql'), 'CREATE SCHEMA custom_app; SET search_path TO custom_app; CREATE TABLE items (id integer PRIMARY KEY);');

    const applied = await runMigrations({ storage: { type: 'postgres', url: pg.url }, dir: migDir });
    expect(applied.map((m) => m.filename)).toEqual(['1_custom_schema.sql']);

    const storage = makeStorage();
    await storage.setItem('after-mig', { value: 'ok', createdAt: 1 });
    expect(await storage.getItem('after-mig')).toEqual({ value: 'ok', createdAt: 1 });

    expect(await tablesIn('public')).toEqual(['mochi_cache', 'mochi_migrations', 'mochi_migrations_cache']);
    expect(await tablesIn('custom_app')).toEqual(['items']);
  });
});

describe('PostgresStorage connections', () => {
  test('one small pool per database is shared by every instance and namespace, and stays bounded across dev reloads', async () => {
    const { proxy, url } = makeProxy();

    const namespaces = ['a', 'b', 'c', 'd'].map((namespace) => makeStorage({ url, namespace }));
    await Promise.all(namespaces.flatMap((s) => Array.from({ length: 8 }, (_, i) => s.setItem(`k${i}`, { value: i, createdAt: 0 }))));
    expect(proxy.open()).toBeGreaterThan(0);
    expect(proxy.open()).toBeLessThanOrEqual(sqlCacheTuning.poolMax);
    expect(sqlBackendStats()).toEqual({ backends: 1, references: 4 });

    // Each dev reload re-evaluates the module holding the storage; nothing ever disposes the previous copy.
    for (let reload = 0; reload < 12; reload++) {
      const copy = new PostgresStorage({ url, namespace: 'hmr', maxAge: 60_000, purgeInterval: 60_000 });
      created.push(copy);
      await Promise.all(Array.from({ length: 8 }, (_, i) => copy.setItem(`k${i}`, { value: reload, createdAt: 0 })));
      expect(proxy.open()).toBeLessThanOrEqual(sqlCacheTuning.poolMax);
    }
    // The takeover released each superseded copy's reference: only the four namespaces and the newest copy hold one.
    expect(sqlBackendStats()).toEqual({ backends: 1, references: 5 });
  });

  test('dispose() releases a reference and the last release closes the client', async () => {
    const { proxy, url } = makeProxy();
    const a = makeStorage({ url, namespace: 'a' });
    const b = makeStorage({ url, namespace: 'b' });
    await a.setItem('k', { value: 1, createdAt: 0 });
    await b.setItem('k', { value: 2, createdAt: 0 });
    expect(sqlBackendStats()).toEqual({ backends: 1, references: 2 });

    await a.dispose();
    expect(sqlBackendStats()).toEqual({ backends: 1, references: 1 });
    expect(await b.getItem('k')).toEqual({ value: 2, createdAt: 0 });
    await expect(a.getItem('k')).rejects.toThrow(/disposed/);

    await b.dispose();
    expect(sqlBackendStats()).toEqual({ backends: 0, references: 0 });
    for (let i = 0; i < 100 && proxy.open() > 0; i++) {
      await wait(10);
    }
    expect(proxy.open()).toBe(0);
  });

  test('connects to the database named in the URL even when PGDATABASE names another', async () => {
    const capture = startStartupCapture();
    const previous = process.env.PGDATABASE;
    process.env.PGDATABASE = 'from_env';
    try {
      const storage = makeStorage({ url: `postgres://app_user:pw@127.0.0.1:${capture.port}/from_url` });
      await expect(storage.getItem('k')).rejects.toThrow();
      expect(capture.startups.length).toBeGreaterThan(0);
      expect(capture.startups[0]).toMatchObject({ user: 'app_user', database: 'from_url' });
    } finally {
      if (previous === undefined) {
        delete process.env.PGDATABASE;
      } else {
        process.env.PGDATABASE = previous;
      }
      capture.close();
    }
  });
});
