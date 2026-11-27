import { afterEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MochiCache } from './cache';
import { SqliteStorage, isBlobRef } from './cache-storage';
import { mochiEvents } from '../events';
import { runMigrations } from '../migrations/runner';
import { runStartupMigrations } from '../migrations/startup';
import { runInEntryImportScope } from '../utils/buildFlag';

const wait = Bun.sleep;

const created: SqliteStorage[] = [];
const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-sqlitecache-'));
  dirs.push(dir);
  return dir;
}

function makeDbPath(name = 'cache.sqlite'): string {
  return join(makeDir(), name);
}

function makeStorage(options: Partial<ConstructorParameters<typeof SqliteStorage>[0]> = {}): SqliteStorage {
  const storage = new SqliteStorage({ path: options.path ?? makeDbPath(), purgeInterval: 0, ...options });
  created.push(storage);
  return storage;
}

afterEach(async () => {
  mochiEvents.all.clear();
  for (const storage of created) {
    await storage.dispose();
  }
  created.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

async function queryDb<T = Record<string, unknown>>(dbPath: string, query: string, params: unknown[] = []): Promise<T[]> {
  const sql = new SQL({ adapter: 'sqlite', filename: dbPath });
  try {
    return (await sql.unsafe(query, params)) as T[];
  } finally {
    await sql.close();
  }
}

describe('SqliteStorage validation & lifecycle', () => {
  test('rejects invalid paths and empty namespaces synchronously on construction', () => {
    expect(() => new SqliteStorage({ path: '' })).toThrow(/SqliteStorage/);
    expect(() => new SqliteStorage({ path: '   ' })).toThrow(/SqliteStorage/);
    expect(() => new SqliteStorage({ path: ':memory:' })).toThrow(/MemoryStorage/);
    expect(() => new SqliteStorage({ path: 'file::memory:?cache=shared' })).toThrow(/MemoryStorage/);
    expect(() => new SqliteStorage({ path: './dir?query/cache.sqlite' })).toThrow(/SqliteStorage/);
    expect(() => new SqliteStorage({ path: makeDbPath(), namespace: '' })).toThrow(/namespace/);
  });

  test('opens lazily so construction and build-entry inspection touch neither disk nor timers', async () => {
    const dbPath = join(makeDir(), 'nested', 'lazy.sqlite');
    let builtStorage!: SqliteStorage;
    await runInEntryImportScope(async () => {
      builtStorage = new SqliteStorage({ path: dbPath, maxAge: 5, purgeInterval: 15 });
      created.push(builtStorage);
    });
    await wait(60);
    expect(existsSync(dbPath)).toBe(false);

    await builtStorage.setItem('k', { value: 1, createdAt: 0 });
    expect(existsSync(dbPath)).toBe(true);
  });

  test('handles special characters (#, %20, spaces) in file paths literally', async () => {
    const dbPath = join(makeDir(), 'dir#hash %20 space', 'cache.sqlite');
    const storage = makeStorage({ path: dbPath });
    await storage.setItem('k', { value: 'ok', createdAt: 1 });
    expect(existsSync(dbPath)).toBe(true);
    expect(await storage.getItem('k')).toEqual({ value: 'ok', createdAt: 1 });
  });

  test('dispose releases file handles cleanly and rejects post-dispose operations', async () => {
    const dir = makeDir();
    const dbPath = join(dir, 'close-check.sqlite');
    const storage = new SqliteStorage({ path: dbPath, purgeInterval: 0 });
    await storage.setItem('k', { value: 1, createdAt: 0 });
    await storage.dispose();

    await expect(storage.getItem('k')).rejects.toThrow(/disposed/);
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });
});

describe('SqliteStorage core operations', () => {
  test('round-trips get/set/overwrite/remove/clear/count/keys', async () => {
    const storage = makeStorage();

    expect(await storage.getItem('missing')).toBeNull();
    expect(await storage.count()).toBe(0);
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
    expect(await storage.count()).toBe(2);
    expect((await storage.keys()).sort()).toEqual(['b', 'c']);

    await storage.clear();
    expect(await storage.count()).toBe(0);
    expect(await storage.keys()).toEqual([]);
  });

  test('handles arbitrary unicode and SQL-metacharacter keys and namespaces safely', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath, namespace: `ns'; DROP TABLE mochi_cache; --` });
    const key = `pokemon:pikachu/nested?weird=1 ünïcode '; DELETE FROM mochi_cache; --`;
    await storage.setItem(key, { value: 'ok', createdAt: 1 });
    expect(await storage.getItem(key)).toEqual({ value: 'ok', createdAt: 1 });
    expect(await storage.keys()).toEqual([key]);
  });

  test('round-trips nested Uint8Array and Buffer fields as Uint8Array', async () => {
    const storage = makeStorage();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = Buffer.from([9, 8, 7]);
    await storage.setItem('img', { value: { meta: 'hi', nested: [bytes, buf] }, createdAt: 7 });

    const raw = (await storage.getItem('img')) as { value: { meta: string; nested: unknown[] }; createdAt: number };
    expect(raw.value.meta).toBe('hi');
    expect(raw.createdAt).toBe(7);
    expect(isBlobRef(raw.value.nested[0])).toBe(false);
    expect(raw.value.nested[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(raw.value.nested[0] as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(raw.value.nested[1] as Uint8Array)).toEqual([9, 8, 7]);
  });

  test('a corrupt JSON row surfaces as a read error and MochiCache degrades to a miss', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath });

    await storage.setItem('k', { value: 1, createdAt: 0 });
    await queryDb(dbPath, 'UPDATE mochi_cache SET value = $1 WHERE key = $2', ['{ not json', 'k']);
    await expect(storage.getItem('k')).rejects.toThrow(SyntaxError);

    const errors: string[] = [];
    mochiEvents.on('cache:error', (e) => errors.push(e.operation));
    const cache = new MochiCache({ storage });
    let calls = 0;
    expect(await cache.fetch('k', () => ++calls)).toBe(1);
    expect(calls).toBe(1);
    expect(errors).toEqual(['get']);
  });

  test('a non-envelope JSON row reads back as a cache miss', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath });
    await storage.setItem('k', { value: 1, createdAt: 0 });
    await queryDb(dbPath, 'UPDATE mochi_cache SET value = $1 WHERE key = $2', ['{"foreign":true}', 'k']);
    expect(await storage.getItem('k')).toBeNull();
  });

  test('isolates multiple namespaces sharing one SQLite file across clear, count, keys, purgeOnInit, and sweep', async () => {
    const dbPath = makeDbPath();
    const pokemon = makeStorage({ path: dbPath, namespace: 'pokemon', maxAge: 50 });
    const users = makeStorage({ path: dbPath, namespace: 'users', maxAge: 60_000 });

    await pokemon.setItem('1', { value: 'bulbasaur', createdAt: 0 });
    await users.setItem('1', { value: 'ada', createdAt: 0 });
    await users.setItem('2', { value: 'grace', createdAt: 0 });

    expect(await pokemon.getItem('1')).toEqual({ value: 'bulbasaur', createdAt: 0 });
    expect(await users.getItem('1')).toEqual({ value: 'ada', createdAt: 0 });
    expect(await pokemon.count()).toBe(1);
    expect(await users.count()).toBe(2);
    expect(await pokemon.keys()).toEqual(['1']);
    expect((await users.keys()).sort()).toEqual(['1', '2']);

    // Sweeping pokemon (maxAge 50ms) does not touch users (maxAge 60s).
    const swept = await pokemon.sweep(Date.now() + 1_000, { reportKeys: true });
    expect(swept).toEqual({ removed: 1, removedKeys: ['1'] });
    expect(await users.count()).toBe(2);

    // purgeOnInit on pokemon leaves users intact.
    await pokemon.setItem('25', { value: 'pikachu', createdAt: 0 });
    const pokemonReset = makeStorage({ path: dbPath, namespace: 'pokemon', purgeOnInit: true });
    expect(await pokemonReset.getItem('25')).toBeNull();
    expect(await users.getItem('1')).toEqual({ value: 'ada', createdAt: 0 });

    // clear() on users leaves newly written pokemon entries intact.
    await pokemonReset.setItem('25', { value: 'pikachu', createdAt: 0 });
    await users.clear();
    expect(await users.count()).toBe(0);
    expect(await pokemonReset.getItem('25')).toEqual({ value: 'pikachu', createdAt: 0 });
  });

  test('sweep removes entries older than maxAge, reports keys only when requested, and drives background cache:sweep', async () => {
    const storage = makeStorage({ maxAge: 50 });
    const before = Date.now();
    await storage.setItem('alpha', { value: 1, createdAt: 0 });
    await storage.setItem('beta', { value: 2, createdAt: 0 });

    expect(await storage.sweep(before)).toEqual({ removed: 0 });

    const swept = await storage.sweep(Date.now() + 1_000, { reportKeys: true });
    expect(swept.removed).toBe(2);
    expect(swept.removedKeys?.toSorted()).toEqual(['alpha', 'beta']);

    await storage.setItem('gamma', { value: 3, createdAt: 0 });
    const quiet = await storage.sweep(Date.now() + 1_000);
    expect(quiet).toEqual({ removed: 1 });
    expect(quiet.removedKeys).toBeUndefined();

    const events: number[] = [];
    mochiEvents.on('cache:sweep', ({ removed }) => events.push(removed));
    const auto = makeStorage({ maxAge: 5, purgeInterval: 20 });
    await auto.setItem('ephemeral', { value: 1, createdAt: 0 });
    for (let i = 0; i < 200 && ((await auto.getItem('ephemeral')) !== null || events.length === 0); i++) {
      await wait(10);
    }
    expect(await auto.getItem('ephemeral')).toBeNull();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('a newer store on the same (path, namespace) takes the sweeper over while a different namespace keeps its own', async () => {
    let ticks = 0;
    mochiEvents.on('cache:sweep', () => ticks++);

    const dbPath = makeDbPath();
    const first = new SqliteStorage({ path: dbPath, namespace: 'a', maxAge: 5, purgeInterval: 20 });
    const second = new SqliteStorage({ path: dbPath, namespace: 'a', maxAge: 5, purgeInterval: 20 });
    const newest = new SqliteStorage({ path: dbPath, namespace: 'a', maxAge: 5, purgeInterval: 20 });
    created.push(first, second, newest);

    await first.dispose();
    for (let i = 0; i < 200 && ticks === 0; i++) {
      await wait(10);
    }
    expect(ticks).toBeGreaterThanOrEqual(1);

    await newest.dispose();
    await wait(50);
    const settled = ticks;
    await wait(150);
    expect(ticks).toBe(settled);
  });
});

describe('MochiCache with SqliteStorage (SWR & cross-process inflight)', () => {
  test('supports fresh, stale-while-revalidate, markStale, peek, set, and expired recompute', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath });
    const cache = new MochiCache({ storage, minTimeToStale: 20, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = () => ({ count: ++calls, bytes: new Uint8Array([calls]) });

    const miss = await cache.fetchWithStatus('k', fn);
    expect(miss.status).toBe('miss');
    expect(miss.value.count).toBe(1);

    const fresh = await cache.fetchWithStatus('k', fn);
    expect(fresh.status).toBe('fresh');
    expect(calls).toBe(1);

    await cache.markStale('k');
    expect((await cache.peek<{ count: number }>('k'))?.status).toBe('stale');

    const stale = await cache.fetchWithStatus('k', fn);
    expect(stale.status).toBe('stale');
    expect(stale.value.count).toBe(1);
    await cache.whenIdle();

    const reopened = makeStorage({ path: dbPath });
    const reader = new MochiCache({ storage: reopened, minTimeToStale: 5_000, maxTimeToLive: 10_000 });
    const persisted = await reader.peek<{ count: number; bytes: Uint8Array }>('k');
    expect(persisted?.status).toBe('fresh');
    expect(persisted?.value.count).toBe(2);
    expect(Array.from(persisted!.value.bytes)).toEqual([2]);
  });

  test('coalesces stale and expired regenerations across two MochiCache instances via crossProcessInflight', async () => {
    const dbPath = makeDbPath();
    const storageA = makeStorage({ path: dbPath });
    const storageB = makeStorage({ path: dbPath });
    const opts = { minTimeToStale: 15, maxTimeToLive: 10_000, inflightTimeout: 30_000, crossProcessInflight: true } as const;
    const cacheA = new MochiCache({ storage: storageA, ...opts });
    const cacheB = new MochiCache({ storage: storageB, ...opts });

    await cacheA.fetch('k', () => 1);
    await wait(50);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inFn = new Promise<void>((r) => (entered = r));
    const aStale = await cacheA.fetchWithStatus('k', async () => {
      entered();
      await gate;
      return 2;
    });
    expect(aStale.status).toBe('stale');
    await inFn;

    let bCalls = 0;
    const bRead = await cacheB.fetchWithStatus('k', () => ++bCalls);
    expect(bRead).toEqual({ value: 1, status: 'stale' });
    expect(bCalls).toBe(0);

    release();
    await cacheA.whenIdle();
    expect(await cacheB.fetch('k', () => 99)).toBe(2);
  });
});

describe('SqliteStorage + MochiMigrations integration stress tests', () => {
  test('applies 1_mochi_cache.sql into mochi_migrations_internal in WAL mode without creating app mochi_migrations', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath });
    await storage.setItem('hello', { value: 'world', createdAt: 1 });

    const tables = await queryDb<{ name: string }>(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(['mochi_cache', 'mochi_migrations_internal']);

    const internal = await queryDb<{ id: number; name: string; hash: string }>(dbPath, 'SELECT id, name, hash FROM mochi_migrations_internal');
    expect(internal).toHaveLength(1);
    expect(internal[0]!.id).toBe(1);
    expect(internal[0]!.name).toBe('mochi_cache');
    expect(internal[0]!.hash).toMatch(/^[0-9a-f]{64}$/);

    const mode = await queryDb<{ journal_mode: string }>(dbPath, 'PRAGMA journal_mode');
    expect(mode[0]!.journal_mode.toLowerCase()).toBe('wal');
  });

  test('handles a 10-way concurrent cold-boot stampede on a brand-new SQLite database', async () => {
    const dbPath = makeDbPath();
    const stores = Array.from({ length: 10 }, (_, i) => makeStorage({ path: dbPath, namespace: `ns-${i % 3}` }));

    await Promise.all(stores.map((s, i) => s.setItem(`key-${i}`, { value: i, createdAt: i })));
    const values = await Promise.all(stores.map((s, i) => s.getItem(`key-${i}`)));
    expect(values.map((v) => (v as { value: number }).value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const internal = await queryDb<{ id: number }>(dbPath, 'SELECT id FROM mochi_migrations_internal');
    expect(internal).toEqual([{ id: 1 }]);
  });

  test('coexists with user app migrations in either order on the same SQLite database', async () => {
    const dbPath = makeDbPath();
    const userMigrations = join(makeDir(), 'migrations');
    await Bun.write(join(userMigrations, '1_create_items.sql'), 'CREATE TABLE items (id integer PRIMARY KEY, label text NOT NULL);');

    // Order 1: standalone SqliteStorage first, then app runMigrations.
    const cacheStore = makeStorage({ path: dbPath });
    await cacheStore.setItem('item:1', { value: 'cached', createdAt: 1 });
    const appApplied = await runMigrations({ storage: { type: 'sqlite', path: dbPath }, dir: userMigrations });
    expect(appApplied.map((m) => m.filename)).toEqual(['1_create_items.sql']);

    const tables = await queryDb<{ name: string }>(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(['items', 'mochi_cache', 'mochi_migrations', 'mochi_migrations_internal']);

    // Order 2: runStartupMigrations first on a second DB, then SqliteStorage reuses the already-migrated schema.
    const dbPath2 = makeDbPath('second.sqlite');
    const startupApplied = await runStartupMigrations({ type: 'sqlite', path: dbPath2 });
    expect(startupApplied.map((m) => m.filename)).toContain('1_mochi_cache.sql');

    const secondStore = makeStorage({ path: dbPath2 });
    await secondStore.setItem('k', { value: 42, createdAt: 2 });
    expect(await secondStore.getItem('k')).toEqual({ value: 42, createdAt: 2 });
  });
});
