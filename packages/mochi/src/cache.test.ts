import { afterEach, describe, expect, test } from 'bun:test';
import { MochiCache, type Storage } from './cache';
import { mochiEvents } from './events';

const wait = Bun.sleep;

afterEach(() => {
  mochiEvents.all.clear();
});

describe('MochiCache.fetch', () => {
  test('fresh hit returns cached value without re-running fn', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => {
      calls++;
      return { n: calls };
    };

    const first = await cache.fetch('k', fn);
    const second = await cache.fetch('k', fn);

    expect(first).toEqual({ n: 1 });
    expect(second).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  test('stale returns cached value and triggers background revalidate', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30);

    const second = await cache.fetchWithStatus('k', fn);
    expect(second.value).toBe(1);
    expect(second.status).toBe('stale');

    // Background revalidate updated the cache shortly after the previous call
    // returned the stale value. The next read sees the revalidated value.
    await wait(20);
    const third = await cache.fetch('k', fn);
    expect(third).toBe(2);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('expired blocks on fn and returns the new value', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 30 });
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(50);

    const result = await cache.fetchWithStatus('k', fn);
    expect(result.value).toBe(2);
    expect(result.status).toBe('expired');
    expect(calls).toBe(2);
  });

  test('delete removes the key so the next fetch re-runs fn', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => ++calls;

    expect(await cache.fetch('k', fn)).toBe(1);
    await cache.delete('k');
    const second = await cache.fetchWithStatus('k', fn);
    expect(second.value).toBe(2);
    expect(second.status).toBe('miss');
    expect(calls).toBe(2);
  });
});

describe('MochiCache custom storage', () => {
  test('round-trips through getItem/setItem on the custom backend', async () => {
    const calls: Array<{ method: 'get' | 'set' | 'remove'; key: string }> = [];
    const store = new Map<string, unknown>();
    const storage: Storage = {
      getItem(key) {
        calls.push({ method: 'get', key });
        return store.get(key) ?? null;
      },
      setItem(key, value) {
        calls.push({ method: 'set', key });
        store.set(key, value);
      },
      removeItem(key) {
        calls.push({ method: 'remove', key });
        store.delete(key);
      },
    };

    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    await cache.fetch('hello', async () => 42);

    const setKeys = calls.filter((c) => c.method === 'set').map((c) => c.key);
    const getKeys = calls.filter((c) => c.method === 'get').map((c) => c.key);
    expect(setKeys).toContain('hello');
    expect(getKeys).toContain('hello');

    await cache.delete('hello');
    expect(calls.some((c) => c.method === 'remove' && c.key === 'hello')).toBe(true);
  });
});

describe('MochiCache events', () => {
  test('emits cache:read on miss then fresh', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    const reads: Array<{ key: string; status: string }> = [];
    mochiEvents.on('cache:read', (e) => reads.push(e));

    await cache.fetch('k', async () => 1);
    await cache.fetch('k', async () => 1);

    const statuses = reads.filter((r) => r.key === 'k').map((r) => r.status);
    expect(statuses).toContain('miss');
    expect(statuses).toContain('fresh');
  });

  test('emits cache:revalidate when serving a stale value', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    const seen: string[] = [];
    mochiEvents.on('cache:revalidate', (e) => seen.push(e.key));

    await cache.fetch('k', async () => ++calls);
    await wait(30);
    await cache.fetch('k', async () => ++calls);
    await wait(20);

    expect(seen).toContain('k');
  });
});

describe('MochiCacheOptions passthrough', () => {
  test('forwards custom serialize/deserialize through to storage', async () => {
    const writes: Array<{ key: string; value: unknown }> = [];
    const store = new Map<string, unknown>();
    const storage: Storage = {
      getItem(key) {
        return store.get(key) ?? null;
      },
      setItem(key, value) {
        writes.push({ key, value });
        store.set(key, value);
      },
      removeItem(key) {
        store.delete(key);
      },
    };

    const cache = new MochiCache({
      storage,
      minTimeToStale: 1_000,
      maxTimeToLive: 5_000,
      serialize: (v) => `wrapped:${JSON.stringify(v)}`,
      deserialize: (v) => JSON.parse(String(v).replace(/^wrapped:/, '')),
    });

    const value = await cache.fetch('k', async () => ({ a: 1 }));
    expect(value).toEqual({ a: 1 });
    // The serialized entry is written as a single wrapper-prefixed payload.
    expect(writes.some((w) => typeof w.value === 'string' && w.value.startsWith('wrapped:'))).toBe(true);
  });
});

describe('MochiCache nullish values', () => {
  test.each([null, undefined])('caches a value of %p as a hit instead of re-running fn', async (returned) => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => {
      calls++;
      return returned;
    };

    expect(await cache.fetch('k', fn)).toBe(returned);
    const second = await cache.fetchWithStatus('k', fn);
    expect(second.value).toBe(returned);
    expect(second.status).toBe('fresh');
    expect(calls).toBe(1);
  });
});

describe('MochiCache concurrency', () => {
  test('concurrent misses on the same key run fn once', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => {
      calls++;
      await wait(20);
      return calls;
    };

    const results = await Promise.all([cache.fetch('k', fn), cache.fetch('k', fn), cache.fetch('k', fn)]);
    expect(results).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });
});
