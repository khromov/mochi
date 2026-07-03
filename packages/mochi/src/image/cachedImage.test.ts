import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedImage } from './cachedImage';
import { resolveImageOptions } from './config';
import { ImageCache, srcHash } from './imageCache';
import { mochiEvents } from '../events';

const SRC = 'https://example.com/photo.png';

// A tiny valid PNG; decoded and re-encoded at 64×64 to give tests a real source.
const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
let SOURCE_BYTES: Uint8Array;
beforeAll(async () => {
  SOURCE_BYTES = await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes();
});

const dirs: string[] = [];
let cache: ImageCache;

async function setup(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-cimg-'));
  dirs.push(dir);
  cache = new ImageCache(dir);
  (globalThis as Record<string, unknown>).__mochi_image_runtime__ = { options: resolveImageOptions({ cacheDir: dir }), cache };
  // Pre-seed the shared original so the wrapper never hits the network.
  await cache.getOriginal(SRC, 3_600_000, 86_400_000, async () => ({ bytes: SOURCE_BYTES, contentType: 'image/png' }));
}

beforeEach(setup);
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__mochi_image_runtime__;
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// Capture cache:read events so we can assert hit/miss without exposing status.
function captureReads(): { statuses: () => string[]; stop: () => void } {
  const events: string[] = [];
  const handler = ({ status }: { key: string; status: string }): void => {
    events.push(status);
  };
  mochiEvents.on('cache:read', handler);
  return { statuses: () => events, stop: () => mochiEvents.off('cache:read', handler) };
}

const missCount = (statuses: string[]): number => statuses.filter((s) => s === 'miss').length;

describe('cachedImage', () => {
  test('cold miss encodes + writes to disk; a warm read hits without re-encoding', async () => {
    const { statuses, stop } = captureReads();
    const first = await cachedImage(SRC).resize(10, 10).webp().bytes();
    const second = await cachedImage(SRC).resize(10, 10).webp().bytes();
    stop();

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(missCount(statuses())).toBe(1); // only the first pass is a variant miss (original stays fresh)

    const files = readdirSync(join(dirs.at(-1)!, srcHash(SRC)));
    expect(files.some((f) => f.endsWith('.webp') && !f.startsWith('original'))).toBe(true);
  });

  test('bytes() and dataurl() for the same chain share one on-disk variant', async () => {
    const { statuses, stop } = captureReads();
    const bytes = await cachedImage(SRC).resize(10, 10).webp().bytes();
    const dataurl = await cachedImage(SRC).resize(10, 10).webp().dataurl();
    stop();

    expect(dataurl.startsWith('data:image/webp;base64,')).toBe(true);
    const decoded = Buffer.from(dataurl.split(',')[1]!, 'base64');
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
    expect(missCount(statuses())).toBe(1); // second terminal reuses the same variant
  });

  test('the cache key is independent of option-property order', async () => {
    await cachedImage(SRC).resize(10, 10, { fit: 'inside', filter: 'nearest' }).webp().bytes(); // warm

    const { statuses, stop } = captureReads();
    await cachedImage(SRC).resize(10, 10, { filter: 'nearest', fit: 'inside' }).webp().bytes(); // same key
    stop();
    expect(missCount(statuses())).toBe(0);
  });

  test('a different chain is a distinct variant (miss)', async () => {
    await cachedImage(SRC).resize(10, 10).webp().bytes(); // warm

    const { statuses, stop } = captureReads();
    await cachedImage(SRC).resize(10, 10).rotate(90).webp().bytes();
    stop();
    expect(missCount(statuses())).toBe(1);
  });

  test('metadata() reflects the transformed dimensions and output format', async () => {
    const meta = await cachedImage(SRC).resize(20, 20, { fit: 'fill' }).webp().metadata();
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(20);
    expect(meta.format).toBe('webp');
  });

  test('placeholder() returns a source-derived data URL and caches it', async () => {
    const ph = await cachedImage(SRC).placeholder();
    expect(ph).not.toBeNull();
    expect(ph!.startsWith('data:image/')).toBe(true);
    expect(await cache.getPlaceholder(SRC)).toBe(ph); // stored in the shared placeholder cache
  });
});
