import { describe, expect, test } from 'bun:test';
import { requestContext } from './requestContext';
import { getRequestCache, requestCache, requestMemo } from './requestCache';

// The cache only needs somewhere to hang its state, so a bare store is enough.
function inRequest<T>(fn: () => T): T {
  return requestContext.run({ islandProps: new Map() } as never, fn);
}

describe('requestCache', () => {
  test('runs the factory once per request and re-runs on the next one', () => {
    let calls = 0;
    const read = () => requestCache('k', () => ++calls);

    expect(inRequest(() => [read(), read(), read()])).toEqual([1, 1, 1]);
    expect(calls).toBe(1);

    expect(inRequest(read)).toBe(2);
    expect(calls).toBe(2);
  });

  test('concurrent async callers share one execution and one promise', async () => {
    let calls = 0;
    const slow = async () => {
      calls++;
      await Bun.sleep(5);
      return 'value';
    };

    const [a, b, c] = await inRequest(() => {
      const p1 = requestCache('k', slow);
      const p2 = requestCache('k', slow);
      const p3 = requestCache('k', slow);
      expect(p1).toBe(p2);
      expect(p2).toBe(p3);
      return Promise.all([p1, p2, p3]);
    });

    expect([a, b, c]).toEqual(['value', 'value', 'value']);
    expect(calls).toBe(1);
  });

  test('a rejected promise is evicted, so a later call can still succeed', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) {
        throw new Error('boom');
      }
      return 'ok';
    };

    await inRequest(async () => {
      await expect(requestCache('k', flaky)).rejects.toThrow('boom');
      expect(await requestCache('k', flaky)).toBe('ok');
      // The successful value is cached from here on.
      expect(await requestCache('k', flaky)).toBe('ok');
    });

    expect(calls).toBe(2);
  });

  test('caches undefined and null as real values', () => {
    let calls = 0;
    inRequest(() => {
      expect(requestCache('u', () => (calls++, undefined))).toBeUndefined();
      expect(requestCache('u', () => (calls++, undefined))).toBeUndefined();
      expect(requestCache('n', () => (calls++, null))).toBeNull();
      expect(requestCache('n', () => (calls++, null))).toBeNull();
    });
    expect(calls).toBe(2);
  });

  test('keys are independent', () => {
    inRequest(() => {
      expect(requestCache('a', () => 1)).toBe(1);
      expect(requestCache('b', () => 2)).toBe(2);
      expect(requestCache('a', () => 99)).toBe(1);
    });
  });

  test('runs uncached with no request context', () => {
    let calls = 0;
    const read = () => requestCache('k', () => ++calls);
    expect(read()).toBe(1);
    expect(read()).toBe(2);
  });
});

describe('requestMemo', () => {
  test('memoizes by arguments within a request', () => {
    let calls = 0;
    const load = requestMemo((id: string) => {
      calls++;
      return `user:${id}`;
    });

    inRequest(() => {
      expect(load('1')).toBe('user:1');
      expect(load('1')).toBe('user:1');
      expect(load('2')).toBe('user:2');
    });
    expect(calls).toBe(2);
  });

  test('type-tags arguments so 1 and "1" do not collide', () => {
    const seen: unknown[] = [];
    const load = requestMemo((id: unknown) => {
      seen.push(id);
      return id;
    });

    inRequest(() => {
      load(1);
      load('1');
      load(1);
    });
    expect(seen).toEqual([1, '1']);
  });

  test('separate wrappers over the same function do not share entries', () => {
    let calls = 0;
    const fn = (id: string) => `${id}:${++calls}`;
    const a = requestMemo(fn);
    const b = requestMemo(fn);

    inRequest(() => {
      expect(a('x')).toBe('x:1');
      expect(b('x')).toBe('x:2');
      expect(a('x')).toBe('x:1');
    });
  });

  test('a shared namespace makes two wrappers share entries', () => {
    let calls = 0;
    const a = requestMemo((id: string) => `${id}:${++calls}`, { namespace: 'shared' });
    const b = requestMemo((id: string) => `${id}:${++calls}`, { namespace: 'shared' });

    inRequest(() => {
      expect(a('x')).toBe('x:1');
      expect(b('x')).toBe('x:1');
    });
  });

  test('a custom key function overrides the default keying', () => {
    let calls = 0;
    const load = requestMemo(
      (user: { id: string; name: string }) => {
        calls++;
        return user.name;
      },
      { key: (user) => user.id },
    );

    inRequest(() => {
      expect(load({ id: '1', name: 'Ada' })).toBe('Ada');
      // Same id, different name — the custom key says it's the same entry.
      expect(load({ id: '1', name: 'Grace' })).toBe('Ada');
    });
    expect(calls).toBe(1);
  });

  test('objects are keyed by their JSON shape by default', () => {
    let calls = 0;
    const load = requestMemo((opts: { a: number }) => {
      calls++;
      return opts.a;
    });

    inRequest(() => {
      load({ a: 1 });
      load({ a: 1 });
      load({ a: 2 });
    });
    expect(calls).toBe(2);
  });

  test('an unserializable argument throws a message pointing at the key option', () => {
    const load = requestMemo((fn: () => void) => fn);
    expect(() => inRequest(() => load(() => {}))).toThrow(/`key` function/);
  });

  test('runs uncached with no request context', () => {
    let calls = 0;
    const load = requestMemo((id: string) => `${id}:${++calls}`);
    expect(load('x')).toBe('x:1');
    expect(load('x')).toBe('x:2');
  });
});

describe('getRequestCache', () => {
  test('exposes get/set/has/delete/clear/size over the request store', () => {
    inRequest(() => {
      const cache = getRequestCache();
      expect(cache.has('k')).toBe(false);
      cache.set('k', 42);
      expect(cache.get<number>('k')).toBe(42);
      expect(cache.has('k')).toBe(true);
      expect(cache.size).toBe(1);
      expect(cache.delete('k')).toBe(true);
      expect(cache.size).toBe(0);

      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  test('shares one store with requestCache/requestMemo', () => {
    inRequest(() => {
      requestCache('k', () => 'v');
      expect(getRequestCache().get<string>('k')).toBe('v');
      getRequestCache().delete('k');
      expect(requestCache('k', () => 'fresh')).toBe('fresh');
    });
  });

  test('counts hits and misses', () => {
    inRequest(() => {
      requestCache('a', () => 1);
      requestCache('a', () => 1);
      requestCache('a', () => 1);
      requestCache('b', () => 2);
      expect(getRequestCache().stats()).toEqual({ hits: 2, misses: 2 });
    });
  });

  test('hands out a throwaway store with no request context', () => {
    const cache = getRequestCache();
    cache.set('k', 1);
    expect(cache.get<number>('k')).toBe(1);
    // A second call is a different store — nothing is shared outside a request.
    expect(getRequestCache().has('k')).toBe(false);
  });
});
