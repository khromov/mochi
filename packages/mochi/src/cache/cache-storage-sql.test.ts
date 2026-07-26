import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MochiCache } from './cache';
import { SqlStorage } from './cache-storage-sql';
import { resolveDialect, toPositional } from '../sql/driver';

const tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-sqlstore-test-'));
const stores: SqlStorage[] = [];

afterAll(async () => {
  await Promise.allSettled(stores.map((s) => s.dispose()));
  rmSync(tmp, { recursive: true, force: true });
});

let dbCount = 0;
function makeStore(options: { maxAge?: number } = {}): SqlStorage {
  // A file per store keeps tests independent without a shared-schema dance.
  const store = new SqlStorage({ url: `sqlite://${path.join(tmp, `s${dbCount++}.db`)}`, purge: false, ...options });
  stores.push(store);
  return store;
}

describe('dialect detection', () => {
  test('recognises sqlite spellings', () => {
    for (const url of ['sqlite://x.db', 'sqlite:/tmp/x.db', 'file://x.db', ':memory:', './cache.sqlite', '/var/data/app.sqlite3']) {
      expect(resolveDialect(url)).toBe('sqlite');
    }
  });

  test('recognises postgres spellings', () => {
    expect(resolveDialect('postgres://u:p@h:5432/d')).toBe('postgres');
    expect(resolveDialect('postgresql://u:p@h:5432/d')).toBe('postgres');
  });

  test('rejects MySQL by name rather than failing later on syntax', () => {
    expect(() => resolveDialect('mysql://u@h/d')).toThrow(/MySQL is not supported/);
  });

  test('rejects an unrecognisable URL', () => {
    expect(() => resolveDialect('redis://localhost')).toThrow(/could not tell which database/);
  });
});

describe('named parameter rewriting', () => {
  test('numbers parameters in first-use order and reuses a repeated name', () => {
    expect(toPositional('a = $one AND b = $two OR c = $one', { one: 1, two: 2 })).toEqual({
      text: 'a = $1 AND b = $2 OR c = $1',
      values: [1, 2],
    });
  });

  test('names a missing parameter instead of binding undefined', () => {
    expect(() => toPositional('a = $missing', {})).toThrow(/\$missing/);
  });
});

describe('SqlStorage', () => {
  test('round-trips values and reports a miss as null', async () => {
    const store = makeStore();
    await store.setItem('a', { hello: 'world', nested: { n: 1 }, list: [1, 2, 3] });

    expect(await store.getItem('a')).toEqual({ hello: 'world', nested: { n: 1 }, list: [1, 2, 3] });
    expect(await store.getItem('nope')).toBeNull();
  });

  test('binary fields survive as Uint8Array', async () => {
    const store = makeStore();
    await store.setItem('bin', { blob: new Uint8Array([0, 127, 255]), label: 'x' });

    const value = (await store.getItem('bin')) as { blob: Uint8Array; label: string };
    expect(value.blob).toBeInstanceOf(Uint8Array);
    expect([...value.blob]).toEqual([0, 127, 255]);
    expect(value.label).toBe('x');
  });

  test('setItem overwrites in place rather than duplicating the key', async () => {
    const store = makeStore();
    await store.setItem('k', 1);
    await store.setItem('k', 2);

    expect(await store.getItem('k')).toBe(2);
    expect(await store.count()).toBe(1);
  });

  test('remove, clear, count and keys', async () => {
    const store = makeStore();
    await store.setItem('a', 1);
    await store.setItem('b', 2);
    expect(await store.count()).toBe(2);
    expect((await store.keys()).sort()).toEqual(['a', 'b']);

    await store.removeItem('a');
    expect(await store.count()).toBe(1);
    await store.clear();
    expect(await store.count()).toBe(0);
    expect(await store.keys()).toEqual([]);
  });

  test('sweep removes only rows past maxAge and can name them', async () => {
    const store = makeStore({ maxAge: 1_000 });
    await store.setItem('old', 1);

    expect((await store.sweep(Date.now())).removed).toBe(0);
    const result = await store.sweep(Date.now() + 5_000, { reportKeys: true });
    expect(result.removed).toBe(1);
    expect(result.removedKeys).toEqual(['old']);
    expect(await store.count()).toBe(0);
  });

  test('rejects a table name that is not a plain identifier', () => {
    expect(() => new SqlStorage({ url: `sqlite://${path.join(tmp, 'bad.db')}`, table: 'a b' })).toThrow(/plain SQL identifier/);
  });

  test('drives a MochiCache end to end, including stale-while-revalidate', async () => {
    const store = makeStore();
    const cache = new MochiCache({ storage: store, minTimeToStale: 10, maxTimeToLive: 60_000 });

    let calls = 0;
    const fn = () => {
      calls++;
      return { n: calls };
    };

    expect(await cache.fetch('k', fn)).toEqual({ n: 1 });
    // Fresh: served from storage, no recompute.
    expect(await cache.fetch('k', fn)).toEqual({ n: 1 });
    expect(calls).toBe(1);

    await Bun.sleep(25);
    const stale = await cache.fetchWithStatus('k', fn);
    expect(stale.status).toBe('stale');
    expect(stale.value).toEqual({ n: 1 });
  });

  test('two connections to one file share entries', async () => {
    const url = `sqlite://${path.join(tmp, 'shared-cache.db')}`;
    const writer = new SqlStorage({ url, purge: false });
    const reader = new SqlStorage({ url, purge: false });
    stores.push(writer, reader);

    await writer.setItem('cross', { seen: true });
    expect(await reader.getItem('cross')).toEqual({ seen: true });
  });
});
