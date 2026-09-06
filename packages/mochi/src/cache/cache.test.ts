import { afterEach, describe, expect, test } from 'bun:test';
import { MochiCache, type Storage } from './cache';
import { mochiEvents } from '../events';

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

  test('clearItems empties every key so the next read recomputes', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => ++calls;

    await cache.fetch('a', fn);
    await cache.fetch('b', fn);
    expect(calls).toBe(2);

    await cache.clearItems();

    expect((await cache.fetchWithStatus('a', fn)).status).toBe('miss');
    expect((await cache.fetchWithStatus('b', fn)).status).toBe('miss');
    expect(calls).toBe(4);
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
      clear() {
        store.clear();
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

    // Exactly one emission for the single stale read.
    expect(seen).toEqual(['k']);
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
      clear() {
        store.clear();
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

describe('MochiCache.set', () => {
  test('overwrites a still-fresh entry that fetch would have skipped', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    await cache.fetch('k', () => 'first');

    // fetch() honours the fresh entry; set() replaces it.
    expect(await cache.fetch('k', () => 'second')).toBe('first');
    await cache.set('k', 'second');
    expect(await cache.peek('k')).toEqual({ value: 'second', status: 'fresh' });
  });

  test('writes a missing key and stamps it fresh', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    await cache.set('k', { a: 1 });
    expect(await cache.peek('k')).toEqual({ value: { a: 1 }, status: 'fresh' });
  });

  test('never leaves the key absent, unlike delete + fetch', async () => {
    // An async backend with a gap before each write, so a non-atomic (remove-then-write) set would expose a null window.
    const store = new Map<string, unknown>();
    const storage: Storage = {
      async getItem(key) {
        await wait(1);
        return store.get(key) ?? null;
      },
      async setItem(key, value) {
        await wait(1);
        store.set(key, value);
      },
      async removeItem(key) {
        await wait(1);
        store.delete(key);
      },
      async clear() {
        store.clear();
      },
    };
    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    await cache.set('k', 'v0');

    let sawMiss = false;
    let stop = false;
    const reader = (async () => {
      while (!stop) {
        if ((await cache.peek('k')) === null) {
          sawMiss = true;
        }
      }
    })();
    for (let i = 1; i <= 20; i++) {
      await cache.set('k', `v${i}`);
    }
    stop = true;
    await reader;
    expect(sawMiss).toBe(false);

    // The contrast: delete + fetch leaves the key absent long enough for a concurrent reader to observe a miss.
    let sawMissDuringReplace = false;
    let replaceDone = false;
    const probe = (async () => {
      while (!replaceDone) {
        if ((await cache.peek('k')) === null) {
          sawMissDuringReplace = true;
        }
      }
    })();
    await cache.delete('k');
    await cache.fetch('k', async () => {
      await wait(10);
      return 'replaced';
    });
    replaceDone = true;
    await probe;
    expect(sawMissDuringReplace).toBe(true);
  });

  test('supersedes a registered in-flight recompute rather than being clobbered by it', async () => {
    // minTimeToStale comfortably above the test's own wall-clock, so the freshness
    // assertion is about `set` stamping the entry, not about elapsed test time.
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    const slow = cache.fetch('k', async () => {
      await wait(30);
      return 'from-fn';
    });
    // Let the run claim its in-flight slot, so this covers the registered-run path; the
    // initial-read gap before registration has its own tests below.
    await wait(5);
    await cache.set('k', 'from-set');

    // The caller still receives its computed value; it just doesn't get written.
    await expect(slow).resolves.toBe('from-fn');
    expect(await cache.peek('k')).toEqual({ value: 'from-set', status: 'fresh' });
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

  test('a hung fn is released by inflightTimeout so a later read starts fresh', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000, inflightTimeout: 30 });
    let calls = 0;
    let release!: (value: number) => void;
    const fn = () =>
      new Promise<number>((resolve) => {
        calls++;
        // First call hangs forever; a later call resolves immediately.
        if (calls === 1) {
          release = resolve;
        } else {
          resolve(calls);
        }
      });

    // Coalesced callers on the hung run all reject once the timeout releases the lock.
    await expect(cache.fetch('k', fn)).rejects.toThrow(/timed out after 30ms/);
    expect(calls).toBe(1);

    // The lock is gone, so a fresh read runs fn again and succeeds.
    expect(await cache.fetch('k', fn)).toBe(2);
    expect(calls).toBe(2);

    // The abandoned first run completing late must not overwrite the cache.
    release(1);
    await wait(10);
    expect(await cache.fetch('k', fn)).toBe(2);
  });

  test('with no cached value, later reads block on the in-flight request', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    let release!: (value: string) => void;
    const fn = () => {
      calls++;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const first = cache.fetch('k', fn);
    const second = cache.fetch('k', fn);

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    await wait(20);
    // fn ran once; the second read is still parked on the in-flight request.
    expect(calls).toBe(1);
    expect(secondSettled).toBe(false);

    release('value');
    expect(await first).toBe('value');
    expect(await second).toBe('value');
    expect(calls).toBe(1);
  });
});

describe('MochiCache stale-while-revalidate', () => {
  test('a stale read returns the cached value immediately, without awaiting revalidation', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    let releaseRevalidate!: (value: number) => void;
    const fn = () => {
      calls++;
      // The first compute resolves; the background revalidation hangs until released.
      if (calls === 1) {
        return Promise.resolve(1);
      }
      return new Promise<number>((resolve) => {
        releaseRevalidate = resolve;
      });
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30); // now stale

    // Even though the revalidation never settles during this call, the read returns at once.
    const stale = await cache.fetchWithStatus('k', fn);
    expect(stale.value).toBe(1);
    expect(stale.status).toBe('stale');
    expect(calls).toBe(2); // background revalidation was kicked off

    releaseRevalidate(2); // let the dangling revalidation settle
  });

  test('concurrent stale reads trigger a single revalidation', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => {
      calls++;
      await wait(20);
      return calls;
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30); // now stale

    const reads = await Promise.all([cache.fetchWithStatus('k', fn), cache.fetchWithStatus('k', fn), cache.fetchWithStatus('k', fn)]);

    expect(reads.map((r) => r.status)).toEqual(['stale', 'stale', 'stale']);
    expect(reads.map((r) => r.value)).toEqual([1, 1, 1]);
    expect(calls).toBe(2); // one initial compute + exactly one revalidation across all three reads
  });

  test('a failing background revalidation emits cache:revalidate:failed and keeps serving stale', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000 });
    const failures: Array<{ key: string; error: unknown }> = [];
    mochiEvents.on('cache:revalidate:failed', (e) => failures.push(e));

    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) {
        return 1;
      }
      throw new Error('upstream down');
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30); // now stale

    const stale = await cache.fetchWithStatus('k', fn);
    expect(stale.value).toBe(1);
    expect(stale.status).toBe('stale');

    // Let the rejected background revalidation settle and emit.
    await wait(10);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.key).toBe('k');
    expect((failures[0]!.error as Error).message).toBe('upstream down');

    // Stale value is still served — the failed refresh did not poison the cache.
    expect((await cache.fetchWithStatus('k', fn)).value).toBe(1);
  });
});

describe('MochiCache.whenIdle', () => {
  test('resolves immediately when nothing is in flight', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000 });
    await cache.fetch('k', () => 1);
    await cache.whenIdle();
    expect(await cache.fetch('k', () => 2)).toBe(1);
  });

  test('waits for a background revalidation to finish, write included', async () => {
    const writes: string[] = [];
    const store = new Map<string, unknown>();
    const storage: Storage = {
      getItem: (key) => store.get(key) ?? null,
      // The write is the last thing a run does, so a whenIdle() that returned
      // early would let the assertion below observe the pre-refresh value.
      setItem: async (key, value) => {
        await wait(30);
        store.set(key, value);
        writes.push(key);
      },
      removeItem: (key) => void store.delete(key),
      clear: () => void store.clear(),
    };
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000, storage });

    let calls = 0;
    const fn = async () => {
      calls++;
      await wait(20);
      return calls;
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30); // now stale

    const stale = await cache.fetchWithStatus('k', fn);
    expect(stale.status).toBe('stale');
    expect(stale.value).toBe(1); // background refresh still running

    await cache.whenIdle();
    expect(writes).toContain('k');
    expect((await cache.fetchWithStatus('k', fn)).value).toBe(2);
  });

  test('a failed background revalidation still settles it', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls > 1) {
        throw new Error('upstream down');
      }
      return 1;
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30);
    expect((await cache.fetchWithStatus('k', fn)).status).toBe('stale');

    await cache.whenIdle(); // must not hang or reject on the rejected run
    expect(calls).toBe(2);
  });
});

describe('MochiCache config validation', () => {
  test('throws when minTimeToStale is not less than maxTimeToLive', () => {
    expect(() => new MochiCache({ minTimeToStale: 5_000, maxTimeToLive: 5_000 })).toThrow(/must be less than/);
    expect(() => new MochiCache({ minTimeToStale: 10_000, maxTimeToLive: 5_000 })).toThrow(/must be less than/);
  });
});

describe('MochiCache async storage', () => {
  test('awaits a Promise-returning backend on read and write', async () => {
    const store = new Map<string, unknown>();
    const storage: Storage = {
      async getItem(key) {
        await wait(1);
        return store.get(key) ?? null;
      },
      async setItem(key, value) {
        await wait(1);
        store.set(key, value);
      },
      async removeItem(key) {
        await wait(1);
        store.delete(key);
      },
      async clear() {
        await wait(1);
        store.clear();
      },
    };

    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => ++calls;

    expect(await cache.fetch('k', fn)).toBe(1);
    expect((await cache.fetchWithStatus('k', fn)).status).toBe('fresh');
    expect(calls).toBe(1);

    await cache.delete('k');
    expect((await cache.fetchWithStatus('k', fn)).status).toBe('miss');
    expect(calls).toBe(2);
  });
});

describe('MochiCache storage-error resilience', () => {
  test('a read failure degrades to a recompute and emits cache:error', async () => {
    const errors: Array<{ key: string; operation: string; error: unknown }> = [];
    mochiEvents.on('cache:error', (e) => errors.push(e));

    const store = new Map<string, unknown>();
    let failNextGet = false;
    const storage: Storage = {
      getItem(key) {
        if (failNextGet) {
          failNextGet = false;
          throw new Error('get boom');
        }
        return store.get(key) ?? null;
      },
      setItem(key, value) {
        store.set(key, value);
      },
      removeItem(key) {
        store.delete(key);
      },
      clear() {
        store.clear();
      },
    };

    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = async () => ++calls;

    expect(await cache.fetch('k', fn)).toBe(1);

    failNextGet = true;
    const result = await cache.fetchWithStatus('k', fn);
    expect(result.status).toBe('miss'); // degraded, not a 500
    expect(result.value).toBe(2);
    expect(errors).toEqual([{ key: 'k', operation: 'get', error: expect.any(Error) }]);
  });

  test('a write failure still returns the computed value and emits cache:error', async () => {
    const errors: Array<{ key: string; operation: string; error: unknown }> = [];
    mochiEvents.on('cache:error', (e) => errors.push(e));

    const storage: Storage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error('set boom');
      },
      removeItem() {},
      clear() {},
    };

    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    expect(await cache.fetch('k', async () => 42)).toBe(42);
    expect(errors).toEqual([{ key: 'k', operation: 'set', error: expect.any(Error) }]);
  });

  test('a removeItem failure emits cache:error and rejects delete', async () => {
    const errors: Array<{ key: string; operation: string; error: unknown }> = [];
    mochiEvents.on('cache:error', (e) => errors.push(e));

    const storage: Storage = {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {
        throw new Error('remove boom');
      },
      clear() {},
    };

    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    await expect(cache.delete('k')).rejects.toThrow('remove boom');
    expect(errors).toEqual([{ key: 'k', operation: 'remove', error: expect.any(Error) }]);
  });
});

describe('MochiCache.peek', () => {
  test('reports status without running fn or emitting cache:read', async () => {
    const cache = new MochiCache({ minTimeToStale: 50, maxTimeToLive: 5_000 });
    const reads: string[] = [];
    mochiEvents.on('cache:read', ({ status }) => reads.push(status));

    expect(await cache.peek('k')).toBeNull(); // miss, no recompute

    let calls = 0;
    await cache.fetch('k', () => {
      calls++;
      return 'v';
    });
    reads.length = 0;

    const peeked = await cache.peek<string>('k');
    expect(peeked).toEqual({ value: 'v', status: 'fresh' });
    expect(calls).toBe(1); // peek never ran fn
    expect(reads).toEqual([]); // peek emits no cache:read
  });

  test('reports expired for an entry past maxTimeToLive without refreshing it', async () => {
    const cache = new MochiCache({ minTimeToStale: 5, maxTimeToLive: 10 });
    let calls = 0;
    await cache.fetch('k', () => {
      calls++;
      return 'v';
    });
    await wait(20);
    expect((await cache.peek('k'))?.status).toBe('expired');
    expect(calls).toBe(1); // still not recomputed
  });
});

describe('MochiCache.markStale', () => {
  test('makes a fresh entry serve stale + revalidate on the next read', async () => {
    const cache = new MochiCache({ minTimeToStale: 10_000, maxTimeToLive: 100_000 });
    let calls = 0;
    const fn = () => {
      calls++;
      return `v${calls}`;
    };

    await cache.fetch('k', fn);
    expect((await cache.peek('k'))?.status).toBe('fresh');

    await cache.markStale('k');
    expect((await cache.peek('k'))?.status).toBe('stale');

    const result = await cache.fetchWithStatus('k', fn);
    expect(result).toEqual({ value: 'v1', status: 'stale' }); // stale value served
    await wait(20);
    expect(calls).toBe(2); // revalidated in the background
  });

  test('is a no-op on a missing key and never freshens an already-stale entry', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 100_000 });
    await expect(cache.markStale('missing')).resolves.toBeUndefined();

    await cache.fetch('k', () => 'v');
    await wait(20); // now already stale
    const before = (await cache.peek('k'))!;
    await cache.markStale('k');
    const after = (await cache.peek('k'))!;
    expect(after.status).toBe('stale');
    expect(after.value).toBe(before.value); // value untouched
  });
});

describe('MochiCache cache:delete event', () => {
  test('delete emits cache:delete with the key', async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    const deleted: string[] = [];
    mochiEvents.on('cache:delete', ({ key }) => deleted.push(key));

    await cache.fetch('k', () => 'v');
    await cache.delete('k');
    expect(deleted).toEqual(['k']);
  });
});

describe('MochiCache invalidation vs in-flight revalidation', () => {
  function makeStorage() {
    const store = new Map<string, unknown>();
    const storage: Storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
      clear: () => store.clear(),
    };
    return { storage, store };
  }

  // Storage is last-writer-wins; the guarantee we keep is that a run whose slot was
  // cleared by a delete while `fn` was still pending skips its write (identity
  // guard), so it can't resurrect a key the caller already removed.
  test('a delete while fn is still pending is not resurrected', async () => {
    const { storage, store } = makeStorage();
    const cache = new MochiCache({ storage, minTimeToStale: 10, maxTimeToLive: 60_000 });

    await cache.fetch('k', () => 'v1');
    await wait(30);

    let releaseFn: (() => void) | undefined;
    expect(
      (
        await cache.fetchWithStatus('k', async () => {
          await new Promise<void>((r) => {
            releaseFn = r;
          });
          return 'v2';
        })
      ).value,
    ).toBe('v1');

    await cache.delete('k'); // completes fully while fn is parked
    releaseFn!();
    await wait(5);

    expect(store.size).toBe(0);
    expect(await cache.peek('k')).toBeNull();
  });

  test('the inflight map is pruned once runs settle', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 60_000 });

    await cache.fetch('k', () => 'v1');
    await wait(30);
    await cache.fetchWithStatus('k', () => 'v2');
    await cache.markStale('k');
    await cache.delete('k');
    await wait(10);

    const internals = cache as unknown as { inflight: Map<string, unknown> };
    expect(internals.inflight.size).toBe(0);
  });
});

describe('MochiCache invalidation during the initial-read gap', () => {
  // A backend whose next read answers from the store immediately but parks before returning, like an async backend
  // whose read was already served when a later write landed; `releaseRead` lets the parked fetch proceed.
  function makeGatedStorage() {
    const store = new Map<string, unknown>();
    let armed = false;
    let release: (() => void) | undefined;
    const storage: Storage = {
      async getItem(key) {
        const raw = store.get(key) ?? null;
        if (armed) {
          armed = false;
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return raw;
      },
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
      clear: () => store.clear(),
    };
    return {
      storage,
      store,
      armRead: () => {
        armed = true;
      },
      releaseRead: () => release!(),
    };
  }

  const expiredEntry = (value: unknown) => ({ value, createdAt: Date.now() - 100_000 });

  test("set() during a fetch's initial read wins over the fetch's later recompute", async () => {
    const cache = new MochiCache({ minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    // The read is already in progress (and answered as a miss) when set runs — no in-flight slot exists yet.
    const pending = cache.fetch('k', () => 'from-fn');
    await cache.set('k', 'from-set');

    await expect(pending).resolves.toBe('from-fn');
    expect(await cache.peek('k')).toEqual({ value: 'from-set', status: 'fresh' });
  });

  test("delete() during a fetch's initial read is not resurrected by the recompute", async () => {
    const { storage, store, armRead, releaseRead } = makeGatedStorage();
    const cache = new MochiCache({ storage, minTimeToStale: 10, maxTimeToLive: 20 });
    store.set('k', expiredEntry('v0'));

    armRead();
    const pending = cache.fetch('k', () => 'from-fn');
    await wait(1);
    await cache.delete('k');
    releaseRead();

    await expect(pending).resolves.toBe('from-fn');
    expect(store.size).toBe(0);
    expect(await cache.peek('k')).toBeNull();
  });

  test("markStale() during a fetch's initial read keeps its backdated entry", async () => {
    const { storage, store, armRead, releaseRead } = makeGatedStorage();
    const cache = new MochiCache({ storage, minTimeToStale: 10_000, maxTimeToLive: 100_000 });
    store.set('k', expiredEntry('v0'));

    armRead();
    const pending = cache.fetch('k', () => 'from-fn');
    await wait(1);
    // A peer replaces the entry while our read is parked, then this process backdates it.
    store.set('k', { value: 'from-peer', createdAt: Date.now() });
    await cache.markStale('k');
    expect(await cache.peek('k')).toEqual({ value: 'from-peer', status: 'stale' });
    releaseRead();

    await expect(pending).resolves.toBe('from-fn');
    expect(await cache.peek('k')).toEqual({ value: 'from-peer', status: 'stale' });
  });

  test("clearItems() during a fetch's initial read is not repopulated by the recompute", async () => {
    const { storage, store, armRead, releaseRead } = makeGatedStorage();
    const cache = new MochiCache({ storage, minTimeToStale: 10, maxTimeToLive: 20 });

    armRead();
    const pending = cache.fetch('k', () => 'from-fn');
    await wait(1);
    await cache.clearItems();
    releaseRead();

    await expect(pending).resolves.toBe('from-fn');
    expect(store.size).toBe(0);
  });

  test("a set() whose write lands after a later fetch's read still wins", async () => {
    const store = new Map<string, unknown>();
    const storage: Storage = {
      getItem: (key) => store.get(key) ?? null,
      async setItem(key, value) {
        await wait(10);
        store.set(key, value);
      },
      removeItem: (key) => void store.delete(key),
      clear: () => store.clear(),
    };
    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });

    // set is called first, but its slow write lands only after the fetch has read a miss and while fn is still running.
    const setting = cache.set('k', 'from-set');
    const pending = cache.fetch('k', async () => {
      await wait(20);
      return 'from-fn';
    });
    await Promise.all([setting, pending]);

    expect(await cache.peek('k')).toEqual({ value: 'from-set', status: 'fresh' });
  });

  test('an uncontended fetch still writes its recompute on miss, stale and expired reads', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 30 });
    let calls = 0;
    const fn = async () => {
      calls++;
      await wait(1);
      return `v${calls}`;
    };

    expect(await cache.fetchWithStatus('k', fn)).toEqual({ value: 'v1', status: 'miss' });
    expect(await cache.peek('k')).toEqual({ value: 'v1', status: 'fresh' });

    await wait(15);
    expect((await cache.fetchWithStatus('k', fn)).status).toBe('stale');
    await cache.whenIdle();
    expect(await cache.peek('k')).toEqual({ value: 'v2', status: 'fresh' });

    await wait(40);
    expect(await cache.fetchWithStatus('k', fn)).toEqual({ value: 'v3', status: 'expired' });
    expect(await cache.peek('k')).toEqual({ value: 'v3', status: 'fresh' });
  });

  test('the generation map is reclaimed once no fetch or run holds the key', async () => {
    const cache = new MochiCache({ minTimeToStale: 10, maxTimeToLive: 60_000, inflightTimeout: 20 });
    const internals = cache as unknown as { generations: Map<string, unknown> };

    // Plain fetch, coalesced fetches, and a set/delete that supersede an unregistered fetch.
    await cache.fetch('a', () => 'v1');
    await Promise.all([cache.fetch('b', () => wait(5).then(() => 'v1')), cache.fetch('b', () => 'v1')]);
    const pending = cache.fetch('c', () => 'v1');
    await cache.set('c', 'v2');
    await cache.delete('c');
    await pending;
    expect(internals.generations.size).toBe(0);

    // A background revalidation outlives its fetch; the entry lives with the run and goes with it.
    await wait(15);
    await cache.fetch('a', () => 'v2');
    expect(internals.generations.has('a')).toBe(true);
    await cache.whenIdle();
    expect(internals.generations.size).toBe(0);

    // A run abandoned by the timeout keeps the entry until the work itself settles, then releases it.
    let release!: (value: string) => void;
    await expect(cache.fetch('d', () => new Promise<string>((r) => (release = r)))).rejects.toThrow(/timed out/);
    expect(internals.generations.has('d')).toBe(true);
    release('late');
    await wait(5);
    expect(internals.generations.size).toBe(0);
    expect(await cache.peek('d')).toBeNull();
  });
});

describe('MochiCache generation bookkeeping under failure', () => {
  // A throwing `cache:error` subscriber is the one way a marker write/remove can reject, and it must not strand the
  // key's generation entry — the refcount is what keeps that map from growing without bound.
  function markerFailingCache(failing: 'set' | 'remove') {
    const store = new Map<string, unknown>();
    const isMarker = (key: string) => key.startsWith('mochi:inflight:');
    const storage: Storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        if (failing === 'set' && isMarker(key)) {
          throw new Error('marker write failed');
        }
        store.set(key, value);
      },
      removeItem: (key) => {
        if (failing === 'remove' && isMarker(key)) {
          throw new Error('marker remove failed');
        }
        store.delete(key);
      },
      clear: () => store.clear(),
    };
    const cache = new MochiCache({ storage, crossProcessInflight: true, inflightTimeout: 5_000 });
    mochiEvents.on('cache:error', () => {
      throw new Error('subscriber blew up');
    });
    return { cache, generations: (cache as unknown as { generations: Map<string, unknown> }).generations };
  }

  test('a rejected marker write still releases the key generation', async () => {
    const { cache, generations } = markerFailingCache('set');
    await expect(cache.fetch('k', () => 'v')).rejects.toThrow('subscriber blew up');
    expect(generations.size).toBe(0);
  });

  test('a rejected marker removal still releases the key generation', async () => {
    const { cache, generations } = markerFailingCache('remove');
    await expect(cache.fetch('k', () => 'v')).rejects.toThrow('subscriber blew up');
    expect(generations.size).toBe(0);
  });

  test('a caller coalesced onto a superseded run is served its value but nothing is stored', async () => {
    const store = new Map<string, unknown>();
    const storage: Storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
      clear: () => store.clear(),
    };
    const cache = new MochiCache({ storage, minTimeToStale: 1_000, maxTimeToLive: 5_000 });

    const first = cache.fetch('k', async () => {
      await wait(20);
      return 'computed';
    });
    await cache.delete('k');
    await wait(5);
    // Enters after the delete has fully landed, but adopts the superseded run rather than starting its own.
    const second = cache.fetch('k', () => 'never-called');

    expect(await first).toBe('computed');
    expect(await second).toBe('computed');
    expect(store.size).toBe(0);
    expect((cache as unknown as { generations: Map<string, unknown> }).generations.size).toBe(0);
  });
});
