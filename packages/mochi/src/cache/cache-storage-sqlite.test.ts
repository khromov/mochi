import { afterEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MochiCache } from './cache';
import { FileStorage, SqliteStorage, isBlobRef } from './cache-storage';
import { sqlBackendStats, sqlCacheTuning } from './sql-backend';
import { sweepBatchSql } from './sql-storage';
import { mochiEvents } from '../events';
import { runMigrations } from '../migrations/runner';
import { runStartupMigrations } from '../migrations/startup';
import { runInEntryImportScope } from '../utils/buildFlag';

const wait = Bun.sleep;

const tuningDefaults = { ...sqlCacheTuning };
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
  Object.assign(sqlCacheTuning, tuningDefaults);
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
  test('rejects invalid options, paths, namespaces, maxAge, and purgeInterval synchronously', () => {
    expect(() => new SqliteStorage({ path: '' })).toThrow(/SqliteStorage/);
    expect(() => new SqliteStorage({ path: '   ' })).toThrow(/SqliteStorage/);
    expect(() => new SqliteStorage({ path: './bad\0path.sqlite' })).toThrow(/SqliteStorage/);
    expect(() => new SqliteStorage({ path: ':memory:' })).toThrow(/MemoryStorage/);
    expect(() => new SqliteStorage({ path: 'file::memory:?cache=shared' })).toThrow(/MemoryStorage/);
    expect(() => new SqliteStorage({ path: './dir?query/cache.sqlite' })).toThrow(/SqliteStorage/);
    expect(() => new SqliteStorage({ path: makeDbPath(), namespace: '' })).toThrow(/namespace/);
    expect(() => new SqliteStorage({ path: makeDbPath(), namespace: '   ' })).toThrow(/namespace/);
    expect(() => new SqliteStorage({ path: makeDbPath(), namespace: 'bad\0ns' })).toThrow(/namespace/);
    expect(() => new SqliteStorage({ path: makeDbPath(), maxAge: 0 })).toThrow(/maxAge/);
    expect(() => new SqliteStorage({ path: makeDbPath(), maxAge: -10 })).toThrow(/maxAge/);
    expect(() => new SqliteStorage({ path: makeDbPath(), maxAge: Number.NaN })).toThrow(/maxAge/);
    expect(() => new SqliteStorage({ path: makeDbPath(), purgeInterval: Number.NaN })).toThrow(/purgeInterval/);
    expect(() => new SqliteStorage({ path: makeDbPath(), purgeInterval: Number.POSITIVE_INFINITY })).toThrow(/purgeInterval/);
    expect(() => new SqliteStorage({ path: makeDbPath(), maxAgeMs: 1_000 } as never)).toThrow(/unknown option "maxAgeMs"/);
  });

  test('trims surrounding whitespace on path and clamps 32-bit timer-overflow purgeIntervals without 1ms sweep storms', async () => {
    const rawDir = makeDir();
    const actualPath = join(rawDir, 'trimmed.sqlite');
    let sweeps = 0;
    mochiEvents.on('cache:sweep', () => sweeps++);

    // 30 days exceeds signed int32 max (2_147_483_647) and would clamp to 1ms if unclamped.
    const storage = makeStorage({ path: `  ${actualPath}  `, purgeInterval: 30 * 24 * 60 * 60 * 1_000, maxAge: 5 });
    await storage.setItem('k', { value: 1, createdAt: 0 });
    expect(existsSync(actualPath)).toBe(true);
    await wait(50);
    expect(sweeps).toBe(0);

    await expect(storage.sweep(Number.NaN)).rejects.toThrow(/finite timestamp/);
  });

  test('maxAge: Infinity never expires entries during sweep', async () => {
    const storage = makeStorage({ maxAge: Number.POSITIVE_INFINITY });
    await storage.setItem('forever', { value: 1, createdAt: 0 });
    expect(await storage.sweep(Date.now() + 1e12, { reportKeys: true })).toEqual({ removed: 0, removedKeys: [] });
    expect(await storage.getItem('forever')).toEqual({ value: 1, createdAt: 0 });
  });

  test('concurrent dispose() calls all wait until in-flight initialization and close finish', async () => {
    const dir = makeDir();
    const dbPath = join(dir, 'concurrent-dispose.sqlite');
    const storage = new SqliteStorage({ path: dbPath, purgeInterval: 0, purgeOnInit: true });
    const pendingWrite = storage.setItem('k', { value: 1, createdAt: 0 }).catch(() => {});
    const [d1, d2] = await Promise.all([storage.dispose(), storage.dispose()]);
    expect(d1).toBeUndefined();
    expect(d2).toBeUndefined();
    await pendingWrite;
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
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
    // Calls already issued on an open database complete; dispose() waits for them.
    const inFlight = [storage.setItem('late', { value: 2, createdAt: 0 }), storage.getItem('k')];
    await storage.dispose();
    expect(await Promise.all(inFlight)).toEqual([undefined, { value: 1, createdAt: 0 }]);

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

  test('preserves ["__proto__"] own properties, multi-key __mochiBinary user objects, and undefined setItem safely', async () => {
    const storage = makeStorage();
    const withProto = JSON.parse('{"__proto__":{"polluted":123},"safe":1}') as Record<string, unknown>;
    const multiKeyBinary = { __mochiBinary: 'not-a-sentinel', extra: 42 };
    await storage.setItem('proto', { value: { withProto, multiKeyBinary }, createdAt: 1 });

    const decoded = (await storage.getItem('proto')) as {
      value: { withProto: Record<string, unknown>; multiKeyBinary: { __mochiBinary: string; extra: number } };
    };
    expect(Object.getPrototypeOf(decoded.value.withProto)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(decoded.value.withProto, '__proto__')?.value).toEqual({ polluted: 123 });
    expect(decoded.value.multiKeyBinary).toEqual({ __mochiBinary: 'not-a-sentinel', extra: 42 });

    await storage.setItem('undef', undefined);
    expect(await storage.getItem('undef')).toBeNull();
  });

  test('a corrupt JSON row surfaces as a read error and MochiCache degrades to a miss', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath });

    await storage.setItem('k', { value: 1, createdAt: 0 });
    await queryDb(dbPath, 'UPDATE mochi_cache SET value = $1 WHERE key_json = $2', ['{ not json', '"k"']);
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
    await queryDb(dbPath, 'UPDATE mochi_cache SET value = $1 WHERE key_json = $2', ['{"foreign":true}', '"k"']);
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

describe('SqliteStorage values and keys match FileStorage', () => {
  test('a Uint8Array inside a class instance round-trips exactly as on FileStorage', async () => {
    class Asset {
      constructor(
        public name: string,
        public bytes: Uint8Array,
      ) {}
    }
    const file = new FileStorage({ directory: join(makeDir(), 'files'), purgeInterval: 0 });
    const storage = makeStorage();
    const value = {
      value: { asset: new Asset('logo', new Uint8Array([1, 2, 3])), list: [new Asset('icon', Buffer.from([4, 5]))], when: new Date(0), tags: new Map([['a', 1]]) },
      createdAt: 1,
    };
    try {
      await file.setItem('k', value);
      await storage.setItem('k', value);
      const fromFile = await file.getItem('k');
      const fromSqlite = (await storage.getItem('k')) as { value: { asset: { bytes: unknown } } };
      expect(fromSqlite.value.asset.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(fromSqlite.value.asset.bytes as Uint8Array)).toEqual([1, 2, 3]);
      expect(fromSqlite).toEqual(fromFile as never);
    } finally {
      file.dispose();
    }
  });

  test('very long keys and keys with NUL or lone surrogates behave as they do on FileStorage', async () => {
    const file = new FileStorage({ directory: join(makeDir(), 'files'), purgeInterval: 0 });
    const storage = makeStorage({ maxAge: 50 });
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
      const swept = await storage.sweep(Date.now() + 1_000, { reportKeys: true });
      expect(swept.removedKeys?.toSorted()).toEqual(keys.toSorted());
    } finally {
      file.dispose();
    }
  });
});

describe('SqliteStorage sweep cost', () => {
  test('deletes in bounded batches, yielding between them, and only returns keys on request', async () => {
    sqlCacheTuning.sweepBatchSize = 10;
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath, maxAge: 1_000 });
    await storage.setItem('seed', { value: 0, createdAt: 0 });
    const seedOld = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < $1) INSERT INTO mochi_cache (namespace, key_hash, key_json, value, written_at) SELECT 'default', 'h' || i, '"old-' || i || '"', '{"__mochiValue":1}', i FROM n`;
    await queryDb(dbPath, seedOld, [45]);

    // Timers and other work run between batches, and see the table shrink step by step.
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

    await queryDb(dbPath, seedOld, [25]);
    const reported = await storage.sweep(Date.now(), { reportKeys: true });
    expect(reported.removed).toBe(25);
    expect(reported.removedKeys?.toSorted()).toEqual(Array.from({ length: 25 }, (_, i) => `old-${i + 1}`).toSorted());
  });
});

describe('SqliteStorage sweep plan', () => {
  test('a batch is looked up by row id, and a large backlog leaves the event loop running', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath, maxAge: 1_000 });
    await storage.setItem('seed', { value: 0, createdAt: 0 });
    const rows = 120_000;
    await queryDb(
      dbPath,
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < $1) INSERT INTO mochi_cache (namespace, key_hash, key_json, value, written_at) SELECT 'default', 'h' || i, '"old-' || i || '"', '{"__mochiValue":1}', i FROM n`,
      [rows],
    );

    // Any plan that reaches the outer rows through an index rescans the backlog for every batch.
    const plan = await queryDb<{ detail: string }>(dbPath, `EXPLAIN QUERY PLAN ${sweepBatchSql('sqlite', 'mochi_cache', false)}`, ['default', 1_000_000, 1_000, 1_000_000]);
    const steps = plan.map((step) => step.detail);
    expect(steps[0]).toBe('SEARCH mochi_cache USING INTEGER PRIMARY KEY (rowid=?)');
    expect(steps.some((step) => step.startsWith('SCAN'))).toBe(false);

    // One statement for everything would hold the write lock, and the event loop with it, until the sweep ends.
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 1);
    expect(await storage.sweep(2_000_000)).toEqual({ removed: rows });
    clearInterval(ticker);
    expect(ticks).toBeGreaterThanOrEqual(5);
    expect(await storage.keys()).toEqual(['seed']);
  }, 60_000);
});

describe('SqliteStorage shared client', () => {
  test('instances and namespaces on one file share a client, and the last dispose() closes it', async () => {
    const dir = makeDir();
    const dbPath = join(dir, 'shared.sqlite');
    const a = new SqliteStorage({ path: dbPath, namespace: 'a', purgeInterval: 0 });
    const b = new SqliteStorage({ path: join(dir, '.', 'shared.sqlite'), namespace: 'b', purgeInterval: 0 });
    await a.setItem('k', { value: 1, createdAt: 0 });
    await b.setItem('k', { value: 2, createdAt: 0 });
    expect(sqlBackendStats()).toEqual({ backends: 1, references: 2 });

    await a.dispose();
    expect(sqlBackendStats()).toEqual({ backends: 1, references: 1 });
    expect(await b.getItem('k')).toEqual({ value: 2, createdAt: 0 });

    await b.dispose();
    expect(sqlBackendStats()).toEqual({ backends: 0, references: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });

  test("a dev reload takes the superseded copy's reference over, so undisposed copies do not pile up", async () => {
    const dbPath = makeDbPath();
    let newest!: SqliteStorage;
    for (let reload = 0; reload < 12; reload++) {
      newest = new SqliteStorage({ path: dbPath, namespace: 'hmr', maxAge: 60_000, purgeInterval: 60_000 });
      created.push(newest);
      await newest.setItem('k', { value: reload, createdAt: 0 });
      expect(sqlBackendStats()).toEqual({ backends: 1, references: 1 });
    }
    // A superseded copy that is still called attaches again instead of failing.
    expect(await created[0]!.getItem('k')).toEqual({ value: 11, createdAt: 0 });
    expect(sqlBackendStats()).toEqual({ backends: 1, references: 2 });

    await newest.dispose();
    await created[0]!.dispose();
    expect(sqlBackendStats()).toEqual({ backends: 0, references: 0 });
  });
});

describe('SqliteStorage schema', () => {
  test('creates mochi_cache and its own tracking table in WAL mode, and nothing else', async () => {
    const dbPath = makeDbPath();
    const storage = makeStorage({ path: dbPath });
    await storage.setItem('hello', { value: 'world', createdAt: 1 });

    const tables = await queryDb<{ name: string }>(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(['mochi_cache', 'mochi_migrations_cache']);

    const tracked = await queryDb<{ id: number; name: string; hash: string }>(dbPath, 'SELECT id, name, hash FROM mochi_migrations_cache');
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.id).toBe(1);
    expect(tracked[0]!.name).toBe('mochi_cache');
    expect(tracked[0]!.hash).toMatch(/^[0-9a-f]{64}$/);

    const mode = await queryDb<{ journal_mode: string }>(dbPath, 'PRAGMA journal_mode');
    expect(mode[0]!.journal_mode.toLowerCase()).toBe('wal');
  });

  test('coexists with app migrations on the same database, which never create the cache tables themselves', async () => {
    const dbPath = makeDbPath();
    const userMigrations = join(makeDir(), 'migrations');
    await Bun.write(join(userMigrations, '1_create_items.sql'), 'CREATE TABLE items (id integer PRIMARY KEY, label text NOT NULL);');

    const appApplied = await runMigrations({ storage: { type: 'sqlite', path: dbPath }, dir: userMigrations });
    expect(appApplied.map((m) => m.filename)).toEqual(['1_create_items.sql']);
    const before = await queryDb<{ name: string }>(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(before.map((t) => t.name)).toEqual(['items', 'mochi_migrations']);

    const cacheStore = makeStorage({ path: dbPath });
    await cacheStore.setItem('item:1', { value: 'cached', createdAt: 1 });
    const after = await queryDb<{ name: string }>(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(after.map((t) => t.name)).toEqual(['items', 'mochi_cache', 'mochi_migrations', 'mochi_migrations_cache']);

    // What Mochi.serve({ storage }) runs at boot has nothing of the cache's to apply.
    const dbPath2 = makeDbPath('second.sqlite');
    expect(await runStartupMigrations({ type: 'sqlite', path: dbPath2 })).toEqual([]);
    expect(existsSync(dbPath2)).toBe(false);
  });
});
