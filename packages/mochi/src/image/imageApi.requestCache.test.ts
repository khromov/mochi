import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getImage, getImagePlaceholder, imagePlaceholder } from './imageApi';
import { resolveImageOptions } from './config';
import { ImageCache } from './imageCache';
import { initExtensions } from '../extensions';
import { requestContext } from '../runtime/requestContext';
import { getRequestCache } from '../runtime/requestCache';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_RUNTIME_KEY = '__mochi_image_runtime__';

const dirs: string[] = [];

function installConfig(): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

// Mirrors imageApi.test.ts: pin the runtime directly so the cache instance is
// shared with the module under test, and hand it back for seeding/spying.
function installRuntime(imageOptions: Record<string, unknown> = {}): ImageCache {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-imgreqcache-'));
  dirs.push(dir);
  const resolved = resolveImageOptions({ ...imageOptions, cacheDir: dir });
  const cache = new ImageCache({ cacheDir: dir, minTimeToStale: resolved.timeToStale, maxTimeToLive: resolved.timeToEvict, sizes: resolved.sizes });
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY] = { options: resolved, cache };
  return cache;
}

// Counts the reads the request cache is meant to collapse, without changing
// behavior — the real method still runs.
function countOriginalReads(cache: ImageCache): () => number {
  let calls = 0;
  const original = cache.getOriginal.bind(cache);
  cache.getOriginal = ((...args: Parameters<ImageCache['getOriginal']>) => {
    calls++;
    return original(...args);
  }) as ImageCache['getOriginal'];
  return () => calls;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
  initExtensions({});
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

const SRC = 'https://example.com/photo.png';

function runInRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ islandProps: new Map() } as never, fn);
}

const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
let SOURCE_BYTES: Uint8Array;
beforeAll(async () => {
  SOURCE_BYTES = await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes();
});

async function seedOriginal(cache: ImageCache): Promise<void> {
  await cache.getOriginal(SRC, async () => ({ bytes: SOURCE_BYTES, contentType: 'image/png' }));
}

describe('getCachedOriginal request caching', () => {
  test('repeat calls for one source in a request read the original once', async () => {
    installConfig();
    const cache = installRuntime();
    initExtensions({});
    await seedOriginal(cache);
    const reads = countOriginalReads(cache);

    const stats = await runInRequestContext(async () => {
      const a = await getImage(SRC);
      const b = await getImage(SRC);
      const c = await getImage(SRC);
      expect(Array.from(a.bytes)).toEqual(Array.from(SOURCE_BYTES));
      // The shared entry is handed to every caller, bytes included.
      expect(b.bytes).toBe(a.bytes);
      expect(c.bytes).toBe(a.bytes);
      return getRequestCache().stats();
    });

    expect(reads()).toBe(1);
    expect(stats.hits).toBeGreaterThanOrEqual(2);
  });

  test('concurrent callers share one in-flight read', async () => {
    installConfig();
    const cache = installRuntime();
    initExtensions({});
    await seedOriginal(cache);
    const reads = countOriginalReads(cache);

    await runInRequestContext(async () => {
      await Promise.all([getImage(SRC), getImage(SRC), getImage(SRC)]);
    });

    expect(reads()).toBe(1);
  });

  test('the entry dies with the request, so a later request sees an invalidation', async () => {
    installConfig();
    const cache = installRuntime();
    initExtensions({});
    await seedOriginal(cache);
    const reads = countOriginalReads(cache);

    await runInRequestContext(async () => {
      await getImage(SRC);
      await getImage(SRC);
    });
    await runInRequestContext(async () => {
      await getImage(SRC);
    });

    expect(reads()).toBe(2);
  });

  test('outside a request it still runs, uncached', async () => {
    installConfig();
    const cache = installRuntime();
    initExtensions({});
    await seedOriginal(cache);
    const reads = countOriginalReads(cache);

    await getImage(SRC);
    await getImage(SRC);

    expect(reads()).toBe(2);
  });
});

describe('getImagePlaceholder request caching', () => {
  test('repeat calls in one request compute the placeholder once', async () => {
    installConfig();
    const cache = installRuntime();
    initExtensions({});
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', Date.now());

    let peeks = 0;
    const original = cache.getPlaceholder.bind(cache);
    cache.getPlaceholder = ((src: string) => {
      peeks++;
      return original(src);
    }) as ImageCache['getPlaceholder'];

    const [a, b] = await runInRequestContext(async () => [await getImagePlaceholder(SRC), await getImagePlaceholder(SRC)]);

    expect(a).toBe('data:image/png;base64,AAAA');
    expect(b).toBe(a);
    expect(peeks).toBe(1);
  });

  // The namespace guard: the non-blocking form caches `null` on a miss, and that
  // must never satisfy the blocking form, which is expected to compute one.
  test('a non-blocking miss does not short-circuit the blocking form', async () => {
    installConfig();
    const cache = installRuntime();
    initExtensions({});
    await seedOriginal(cache);

    const result = await runInRequestContext(async () => {
      const nonBlocking = await imagePlaceholder(SRC);
      expect(nonBlocking).toBeNull();
      return getImagePlaceholder(SRC);
    });

    expect(result).toBeString();
    expect(result).toStartWith('data:');
  });
});
