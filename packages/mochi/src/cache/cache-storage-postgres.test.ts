import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MochiCache } from './cache';
import { PostgresStorage, isBlobRef } from './cache-storage';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';
import { mochiEvents } from '../events';
import { runMigrations } from '../migrations/runner';
import { clearInternalMigrationsCache } from '../migrations/startup';

const wait = Bun.sleep;

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-pgcache-'));
let pg: TestPostgres;
const created: PostgresStorage[] = [];

beforeAll(async () => {
  pg = await startTestPostgres({ maxConnections: Infinity });
});

beforeEach(async () => {
  clearInternalMigrationsCache({ type: 'postgres', url: pg.url });
  await pg.query('DROP SCHEMA IF EXISTS mochi_cache CASCADE');
  await pg.query('DROP SCHEMA IF EXISTS custom_app CASCADE');
  await pg.query('DROP SCHEMA public CASCADE');
  await pg.query('CREATE SCHEMA public');
});

afterEach(async () => {
  mochiEvents.all.clear();
  for (const storage of created) {
    await storage.dispose();
  }
  created.length = 0;
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

describe('PostgresStorage validation & core operations', () => {
  test('rejects invalid URLs and empty namespaces synchronously on construction', () => {
    expect(() => new PostgresStorage({ url: '' })).toThrow(/PostgresStorage/);
    expect(() => new PostgresStorage({ url: '   ' })).toThrow(/PostgresStorage/);
    expect(() => new PostgresStorage({ url: './local.sqlite' })).toThrow(/PostgresStorage/);
    expect(() => new PostgresStorage({ url: 'http://localhost:5432/db' })).toThrow(/PostgresStorage/);
    expect(() => new PostgresStorage({ url: pg.url, namespace: '' })).toThrow(/namespace/);
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
    const storage = makeStorage({ namespace: `ns'; DROP SCHEMA mochi_cache CASCADE; --` });
    const key = `pokemon:pikachu/nested?weird=1 ünïcode '; DELETE FROM mochi_cache.entries; --`;
    const bytes = new Uint8Array([10, 20, 30]);
    const buf = Buffer.from([40, 50]);

    await storage.setItem(key, { value: { ok: true, nested: [bytes, buf] }, createdAt: 7 });
    const raw = (await storage.getItem(key)) as { value: { ok: boolean; nested: unknown[] }; createdAt: number };
    expect(raw.value.ok).toBe(true);
    expect(isBlobRef(raw.value.nested[0])).toBe(false);
    expect(raw.value.nested[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(raw.value.nested[0] as Uint8Array)).toEqual([10, 20, 30]);
    expect(Array.from(raw.value.nested[1] as Uint8Array)).toEqual([40, 50]);
  });

  test('a corrupt JSON row surfaces as a read error and MochiCache degrades to a miss', async () => {
    const storage = makeStorage();
    await storage.setItem('k', { value: 1, createdAt: 0 });
    await pg.query("UPDATE mochi_cache.entries SET value = '{ not json' WHERE key = 'k'");
    await expect(storage.getItem('k')).rejects.toThrow(SyntaxError);

    const errors: string[] = [];
    mochiEvents.on('cache:error', (e) => errors.push(e.operation));
    const cache = new MochiCache({ storage });
    let calls = 0;
    expect(await cache.fetch('k', () => ++calls)).toBe(1);
    expect(calls).toBe(1);
    expect(errors).toEqual(['get']);
  });

  test('isolates multiple namespaces on mochi_cache.entries across clear, count, keys, purgeOnInit, and sweep', async () => {
    const pokemon = makeStorage({ namespace: 'pokemon', maxAge: 50 });
    const users = makeStorage({ namespace: 'users', maxAge: 60_000 });

    await pokemon.setItem('1', { value: 'bulbasaur', createdAt: 0 });
    await users.setItem('1', { value: 'ada', createdAt: 0 });
    await users.setItem('2', { value: 'grace', createdAt: 0 });

    expect(await pokemon.count()).toBe(1);
    expect(await users.count()).toBe(2);

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

describe('PostgresStorage + MochiMigrations integration stress tests', () => {
  test('creates mochi_cache.entries and records 1_mochi_cache.sql in mochi_migrations_internal under concurrent cold boot', async () => {
    const stores = Array.from({ length: 6 }, (_, i) => makeStorage({ namespace: `replica-${i % 2}` }));
    await Promise.all(stores.map((s, i) => s.setItem(`k-${i}`, { value: i, createdAt: i })));

    const tracked = await pg.query<{ id: number; name: string; hash: string }>('SELECT id, name, hash FROM public.mochi_migrations_internal');
    expect(tracked.rows).toHaveLength(1);
    expect(tracked.rows[0]!.id).toBe(1);
    expect(tracked.rows[0]!.name).toBe('mochi_cache');
    expect(tracked.rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);

    const count = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM mochi_cache.entries');
    expect(count.rows[0]!.n).toBe(6);
  });

  test('schema-qualified mochi_cache.entries works alongside user migrations that alter search_path', async () => {
    const migDir = path.join(root, 'app-migrations');
    mkdirSync(migDir, { recursive: true });
    writeFileSync(path.join(migDir, '1_custom_schema.sql'), 'CREATE SCHEMA custom_app; SET search_path TO custom_app; CREATE TABLE items (id integer PRIMARY KEY);');

    const applied = await runMigrations({ storage: { type: 'postgres', url: pg.url }, dir: migDir });
    expect(applied.map((m) => m.filename)).toEqual(['1_custom_schema.sql']);

    const storage = makeStorage();
    await storage.setItem('after-mig', { value: 'ok', createdAt: 1 });
    expect(await storage.getItem('after-mig')).toEqual({ value: 'ok', createdAt: 1 });

    const appTracked = await pg.query<{ id: number }>('SELECT id FROM public.mochi_migrations');
    const internalTracked = await pg.query<{ id: number }>('SELECT id FROM public.mochi_migrations_internal');
    expect(appTracked.rows).toEqual([{ id: 1 }]);
    expect(internalTracked.rows).toEqual([{ id: 1 }]);
  });
});
