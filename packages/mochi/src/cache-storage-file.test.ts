import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MochiCache } from './cache';
import { FileStorage, isBlobRef, readBlobRef, type BlobRef } from './cache-storage';
import { mochiEvents } from './events';

const wait = Bun.sleep;

// Track every store/dir a test creates so we can tear timers + files down.
const created: FileStorage[] = [];
const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-filecache-'));
  dirs.push(dir);
  return dir;
}

function makeStorage(options: Partial<ConstructorParameters<typeof FileStorage>[0]> = {}): FileStorage {
  // Disable the background sweeper by default so tests don't leak timers; the
  // sweep tests call `sweep()` directly.
  const storage = new FileStorage({ directory: makeDir(), purgeInterval: 0, ...options });
  created.push(storage);
  return storage;
}

afterEach(() => {
  mochiEvents.all.clear();
  for (const storage of created) {
    storage.dispose();
  }
  created.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('FileStorage', () => {
  test('round-trips get/set/remove/clear', async () => {
    const storage = makeStorage();

    expect(await storage.getItem('missing')).toBeNull();

    await storage.setItem('a', { value: 1, createdAt: 123 });
    expect(await storage.getItem('a')).toEqual({ value: 1, createdAt: 123 });

    await storage.removeItem('a');
    expect(await storage.getItem('a')).toBeNull();

    await storage.setItem('b', { value: 2, createdAt: 0 });
    await storage.setItem('c', { value: 3, createdAt: 0 });
    await storage.clear();
    expect(await storage.getItem('b')).toBeNull();
    expect(await storage.getItem('c')).toBeNull();
  });

  test('removeItem on a missing key is a no-op', async () => {
    const storage = makeStorage();
    await expect(storage.removeItem('nope')).resolves.toBeUndefined();
  });

  test('handles arbitrary key strings via hashing', async () => {
    const storage = makeStorage();
    const key = 'pokemon:pikachu/nested?weird=1 ünïcode';
    await storage.setItem(key, { value: 'ok', createdAt: 1 });
    expect(await storage.getItem(key)).toEqual({ value: 'ok', createdAt: 1 });
  });

  test('a corrupt file surfaces as a read error (cache degrades to a miss)', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);

    await storage.setItem('k', { value: 1, createdAt: 0 });
    // Overwrite the on-disk file with invalid JSON.
    const file = readdirSync(dir).find((n) => n.endsWith('.json'));
    expect(file).toBeDefined();
    await Bun.write(join(dir, file!), '{ not json');
    await expect(storage.getItem('k')).rejects.toBeDefined();

    // Wired through MochiCache, a read error degrades to a `miss` + recompute.
    const cache = new MochiCache({ storage });
    let calls = 0;
    expect(await cache.fetch('k', () => ++calls)).toBe(1);
    expect(calls).toBe(1);
  });

  test('persists across FileStorage instances on the same directory', async () => {
    const dir = makeDir();
    const first = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(first);
    await first.setItem('k', { value: 'persisted', createdAt: 42 });

    const second = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(second);
    expect(await second.getItem('k')).toEqual({ value: 'persisted', createdAt: 42 });
  });

  test('purgeOnInit clears the directory on construction', async () => {
    const dir = makeDir();
    const first = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(first);
    await first.setItem('k', { value: 1, createdAt: 0 });
    expect(readdirSync(dir).length).toBeGreaterThan(0);

    const fresh = new FileStorage({ directory: dir, purgeInterval: 0, purgeOnInit: true });
    created.push(fresh);
    expect(readdirSync(dir).filter((n) => n.endsWith('.json'))).toEqual([]);
    expect(await fresh.getItem('k')).toBeNull();
  });

  test('sweep removes files older than maxAge and keeps fresh ones', async () => {
    const storage = makeStorage({ maxAge: 50 });
    await storage.setItem('k', { value: 1, createdAt: 0 });

    // Nothing expired yet.
    expect(await storage.sweep()).toEqual({ removed: 0, freedBytes: 0 });
    expect(await storage.getItem('k')).not.toBeNull();

    // Advance the clock past maxAge relative to the file's mtime.
    const swept = await storage.sweep(Date.now() + 1_000);
    expect(swept.removed).toBe(1);
    expect(await storage.getItem('k')).toBeNull();
  });

  test('background sweeper emits cache:sweep', async () => {
    const events: number[] = [];
    mochiEvents.on('cache:sweep', ({ removed }) => events.push(removed));

    const storage = makeStorage({ maxAge: 5, purgeInterval: 20 });
    await storage.setItem('k', { value: 1, createdAt: 0 });
    await wait(60);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(await storage.getItem('k')).toBeNull();
  });
});

describe('MochiCache with FileStorage (stale-while-revalidate)', () => {
  test('fresh hit does not re-run fn', async () => {
    const cache = new MochiCache({ storage: makeStorage(), minTimeToStale: 1_000, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = () => ++calls;

    expect(await cache.fetch('k', fn)).toBe(1);
    expect(await cache.fetch('k', fn)).toBe(1);
    expect(calls).toBe(1);
  });

  test('stale returns cached value and revalidates in the background', async () => {
    const cache = new MochiCache({ storage: makeStorage(), minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = () => ++calls;

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30);

    const stale = await cache.fetchWithStatus('k', fn);
    expect(stale.value).toBe(1);
    expect(stale.status).toBe('stale');

    await wait(20);
    expect(await cache.fetch('k', fn)).toBe(2);
  });

  test('expired blocks on fn and returns the new value', async () => {
    const cache = new MochiCache({ storage: makeStorage(), minTimeToStale: 10, maxTimeToLive: 30 });
    let calls = 0;
    const fn = () => ++calls;

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(50);

    const expired = await cache.fetchWithStatus('k', fn);
    expect(expired.value).toBe(2);
    expect(expired.status).toBe('expired');
  });

  test('stale read returns immediately without awaiting the background revalidation', async () => {
    const cache = new MochiCache({ storage: makeStorage(), minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    let revalidateStarted = false;
    // A deliberately slow revalidation: if the stale read awaited it, the read
    // below would take >= 100ms.
    const fn = async () => {
      calls++;
      if (calls > 1) {
        revalidateStarted = true;
        await wait(100);
      }
      return calls;
    };

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30);

    const start = Date.now();
    const stale = await cache.fetchWithStatus('k', fn);
    const elapsed = Date.now() - start;

    expect(stale).toEqual({ value: 1, status: 'stale' });
    expect(revalidateStarted).toBe(true); // background refetch was kicked off
    expect(elapsed).toBeLessThan(80); // ...but the stale read did NOT wait for it
  });

  test('background revalidation writes the refreshed value through to disk', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);
    const cache = new MochiCache({ storage, minTimeToStale: 10, maxTimeToLive: 5_000 });
    let calls = 0;
    const fn = () => ++calls;

    expect(await cache.fetch('k', fn)).toBe(1);
    await wait(30);

    // Trigger the stale read; it returns 1 and revalidates in the background.
    expect((await cache.fetchWithStatus('k', fn)).status).toBe('stale');
    await wait(20); // let the background write settle

    // A brand-new FileStorage over the same directory sees the persisted refresh —
    // proving SWR wrote the new value through to disk, not just in memory.
    const reopened = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(reopened);
    const entry = (await reopened.getItem('k')) as { value: number } | null;
    expect(entry?.value).toBe(2);
  });
});

describe('FileStorage binary offload', () => {
  function countDirs(dir: string): number {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  }

  test('offloads a binary field to a nested folder and resolves it lazily', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await storage.setItem('img', { value: { meta: 'hi', bytes }, createdAt: 7 });

    // The JSON no longer carries the raw bytes; a blob folder holds them.
    expect(countDirs(dir)).toBe(1);

    const raw = (await storage.getItem('img')) as { value: { meta: string; bytes: BlobRef }; createdAt: number };
    expect(raw.value.meta).toBe('hi');
    expect(raw.createdAt).toBe(7);
    // Binary field comes back as a lazy ref, not eagerly-loaded bytes.
    expect(isBlobRef(raw.value.bytes)).toBe(true);
    expect(raw.value.bytes.bytes).toBe(5);
    expect(Array.from(await readBlobRef(raw.value.bytes))).toEqual([1, 2, 3, 4, 5]);
  });

  test('removeItem reclaims the blob folder with the JSON', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);

    await storage.setItem('img', { value: { bytes: new Uint8Array([9]) }, createdAt: 0 });
    expect(countDirs(dir)).toBe(1);
    await storage.removeItem('img');
    expect(readdirSync(dir)).toHaveLength(0);
  });

  test('clear removes blob folders too', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);

    await storage.setItem('a', { value: { bytes: new Uint8Array([1]) }, createdAt: 0 });
    await storage.setItem('b', { value: { bytes: new Uint8Array([2]) }, createdAt: 0 });
    await storage.clear();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  test('sweep reclaims aged-out blob folders and reports freed bytes', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0, maxAge: 1_000 });
    created.push(storage);

    await storage.setItem('img', { value: { bytes: new Uint8Array([1, 2, 3]) }, createdAt: 0 });
    expect(countDirs(dir)).toBe(1);

    const swept = await storage.sweep(Date.now() + 10_000);
    expect(swept.removed).toBe(1);
    expect(swept.freedBytes).toBeGreaterThan(0);
    expect(readdirSync(dir)).toHaveLength(0); // json + blob folder both gone
  });

  test('re-persisting a read-back value keeps the existing blob (markStale path)', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    const cache = new MochiCache({ minTimeToStale: 50, maxTimeToLive: 10_000, storage });
    created.push(storage);

    await cache.fetch('img', () => ({ bytes: new Uint8Array([5, 5, 5]) }));
    await cache.markStale('img'); // reads the BlobRef back and re-persists the envelope
    const after = (await storage.getItem('img')) as { value: { bytes: BlobRef } };
    expect(isBlobRef(after.value.bytes)).toBe(true);
    expect(Array.from(await readBlobRef(after.value.bytes))).toEqual([5, 5, 5]);
    // Still exactly one blob folder — markStale reused it rather than orphaning one.
    expect(countDirs(dir)).toBe(1);
  });
});
