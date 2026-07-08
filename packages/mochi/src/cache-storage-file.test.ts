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
    expect(await storage.sweep()).toEqual({ removed: 0 });
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

  test('sweep reclaims aged-out blob folders', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0, maxAge: 1_000 });
    created.push(storage);

    await storage.setItem('img', { value: { bytes: new Uint8Array([1, 2, 3]) }, createdAt: 0 });
    expect(countDirs(dir)).toBe(1);

    const swept = await storage.sweep(Date.now() + 10_000);
    expect(swept.removed).toBe(1);
    expect(readdirSync(dir)).toHaveLength(0); // json + blob folder both gone
  });

  test('sweep leaves a young orphaned blob folder for a later pass (in-flight first write)', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0, maxAge: 1_000 });
    created.push(storage);

    // A blob folder with no owning JSON — exactly what a concurrent first write
    // looks like between its blob rename and its JSON rename.
    await Bun.write(join(dir, 'deadbeef', 'b0.bin'), new Uint8Array([1, 2, 3]));

    await storage.sweep(Date.now());
    expect(countDirs(dir)).toBe(1);

    // Once older than the grace window it's a genuine crash orphan — reclaimed.
    await storage.sweep(Date.now() + 20_000);
    expect(countDirs(dir)).toBe(0);
  });

  test('content-addressed blobs never serve torn bytes: each ref reads its own generation', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);

    await storage.setItem('img', { value: { bytes: new Uint8Array([1, 1, 1]) }, createdAt: 1 });
    const gen1 = (await storage.getItem('img')) as { value: { bytes: BlobRef } };
    await storage.setItem('img', { value: { bytes: new Uint8Array([2, 2, 2, 2]) }, createdAt: 2 });
    const gen2 = (await storage.getItem('img')) as { value: { bytes: BlobRef } };

    // Different bytes → different content-addressed filename, so the two refs never
    // alias: the new bytes are written to a new file rather than over gen1's.
    expect(gen2.value.bytes.path).not.toBe(gen1.value.bytes.path);
    expect(Array.from(await readBlobRef(gen2.value.bytes))).toEqual([2, 2, 2, 2]);
    // The superseded blob is left on disk (reclaimed with the folder later), so an
    // outstanding gen1 ref still reads its own bytes — never gen2's.
    expect(Array.from(await readBlobRef(gen1.value.bytes))).toEqual([1, 1, 1]);
  });

  test('identical bytes dedupe to a single content-addressed blob file', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);

    await storage.setItem('img', { value: { bytes: new Uint8Array([7, 7]) }, createdAt: 1 });
    await storage.setItem('img', { value: { bytes: new Uint8Array([7, 7]) }, createdAt: 2 });

    const blobDirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(blobDirs).toHaveLength(1);
    // Same bytes → same digest → one file, no rewrite on the second setItem.
    expect(readdirSync(join(dir, blobDirs[0]!.name))).toHaveLength(1);
    const current = (await storage.getItem('img')) as { value: { bytes: BlobRef } };
    expect(Array.from(await readBlobRef(current.value.bytes))).toEqual([7, 7]);
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

  test('count reports the number of persisted entries (json files only)', async () => {
    const storage = makeStorage();
    expect(await storage.count()).toBe(0);

    await storage.setItem('a', { value: 1, createdAt: 0 });
    await storage.setItem('b', { value: { bytes: new Uint8Array([1, 2]) }, createdAt: 0 });
    // Two entries — the blob folder for 'b' must not inflate the count.
    expect(await storage.count()).toBe(2);

    await storage.removeItem('a');
    expect(await storage.count()).toBe(1);

    await storage.clear();
    expect(await storage.count()).toBe(0);
  });

  test('durable write leaves no temp files behind (all renamed into place)', async () => {
    const dir = makeDir();
    const storage = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storage);

    await storage.setItem('img', { value: { meta: 'hi', bytes: new Uint8Array([1, 2, 3, 4]) }, createdAt: 0 });

    // Round-trips through the durable-write path.
    const raw = (await storage.getItem('img')) as { value: { meta: string; bytes: BlobRef } };
    expect(raw.value.meta).toBe('hi');
    expect(Array.from(await readBlobRef(raw.value.bytes))).toEqual([1, 2, 3, 4]);

    // No `.tmp` survivors anywhere — every temp write was fsynced then renamed.
    const tmpLeftovers = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.name.endsWith('.tmp'));
    expect(tmpLeftovers).toHaveLength(0);
  });
});

// Two MochiCache instances over one shared directory model two load-balanced
// processes: each has its own in-process `inflight` Map but a common FileStorage,
// which reads fresh from disk on every getItem — so the advisory marker one writes
// is visible to the other.
describe('MochiCache cross-process in-flight marker (shared FileStorage)', () => {
  // Mirrors MochiCache.markerKey — the tests are deliberately white-box on this.
  const markerKey = (key: string) => `mochi:inflight:${key}`;

  async function waitForMarker(storage: FileStorage, key: string, present: boolean): Promise<void> {
    for (let i = 0; i < 250; i++) {
      const raw = await storage.getItem(markerKey(key));
      if ((raw != null) === present) {
        return;
      }
      await wait(2);
    }
    throw new Error(`marker for "${key}" never became ${present ? 'present' : 'absent'}`);
  }

  function twoProcesses(opts: { minTimeToStale: number; maxTimeToLive: number; inflightTimeout: number }) {
    const dir = makeDir();
    const storageA = new FileStorage({ directory: dir, purgeInterval: 0 });
    const storageB = new FileStorage({ directory: dir, purgeInterval: 0 });
    created.push(storageA, storageB);
    const common = { ...opts, crossProcessInflight: true } as const;
    return {
      storageA,
      storageB,
      cacheA: new MochiCache({ storage: storageA, ...common }),
      cacheB: new MochiCache({ storage: storageB, ...common }),
    };
  }

  test('a peer refreshing a stale entry makes another process serve stale without re-running fn', async () => {
    const { storageA, cacheA, cacheB } = twoProcesses({ minTimeToStale: 20, maxTimeToLive: 10_000, inflightTimeout: 1_000 });

    await cacheA.fetch('k', () => 1);
    await wait(40); // age into the stale window on both

    // A serves stale and kicks off a background revalidation that parks in fn,
    // holding the marker for the duration.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let aCalls = 0;
    const aStale = await cacheA.fetchWithStatus('k', async () => {
      aCalls++;
      await gate;
      return 2;
    });
    expect(aStale.status).toBe('stale');
    await waitForMarker(storageA, 'k', true);

    // B hits the same stale entry, sees A's fresh marker, and defers.
    const deferred: string[] = [];
    mochiEvents.on('cache:inflight:deferred', (e) => deferred.push(e.key));
    let bCalls = 0;
    const bRead = await cacheB.fetchWithStatus('k', () => {
      bCalls++;
      return 99;
    });

    expect(bRead).toEqual({ value: 1, status: 'stale' });
    expect(bCalls).toBe(0); // B did NOT run a duplicate regeneration
    expect(deferred).toContain('k');

    // Release A: exactly one regeneration happened across both processes.
    release();
    await waitForMarker(storageA, 'k', false);
    expect(aCalls).toBe(1);
  });

  test('a peer refreshing an expired entry makes another process serve the old value instead of recomputing', async () => {
    const { storageA, cacheA, cacheB } = twoProcesses({ minTimeToStale: 10, maxTimeToLive: 30, inflightTimeout: 1_000 });

    await cacheA.fetch('k', () => 1);
    await wait(50); // past maxTimeToLive → expired on both

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let aCalls = 0;
    // The expired path awaits run(), so A's read only resolves once fn releases.
    const aRead = cacheA.fetchWithStatus('k', async () => {
      aCalls++;
      await gate;
      return 2;
    });
    await waitForMarker(storageA, 'k', true);

    let bCalls = 0;
    const bRead = await cacheB.fetchWithStatus('k', () => {
      bCalls++;
      return 99;
    });
    expect(bRead).toEqual({ value: 1, status: 'stale' });
    expect(bCalls).toBe(0);

    release();
    expect((await aRead).value).toBe(2);
    expect(aCalls).toBe(1);
  });

  test('a marker past its lease is ignored so a crashed peer never blocks regeneration', async () => {
    const inflightTimeout = 100;
    const { storageA, cacheA } = twoProcesses({ minTimeToStale: 10, maxTimeToLive: 30, inflightTimeout });

    await cacheA.fetch('k', () => 1);
    await wait(50); // expired

    // A crashed peer left a marker behind, now older than the lease.
    await storageA.setItem(markerKey('k'), { startedAt: Date.now() - (inflightTimeout + 50) });

    let calls = 0;
    const read = await cacheA.fetchWithStatus('k', () => {
      calls++;
      return 2;
    });
    expect(read).toEqual({ value: 2, status: 'expired' });
    expect(calls).toBe(1); // stale marker did not make us defer
  });

  test('does not defer to our own in-process regeneration — concurrent expired callers coalesce to one fresh regen', async () => {
    const { cacheA } = twoProcesses({ minTimeToStale: 10, maxTimeToLive: 30, inflightTimeout: 1_000 });
    let calls = 0;
    const fn = async () => {
      calls++;
      await wait(20);
      return calls;
    };

    await cacheA.fetch('k', fn); // calls = 1
    await wait(50); // expired

    const [a, b] = await Promise.all([cacheA.fetchWithStatus('k', fn), cacheA.fetchWithStatus('k', fn)]);
    expect(a.value).toBe(2);
    expect(b.value).toBe(2); // both fresh via local coalescing, neither served stale
    expect(calls).toBe(2); // exactly one regeneration
  });

  test('delete removes the marker', async () => {
    const { storageA, storageB, cacheA } = twoProcesses({ minTimeToStale: 10, maxTimeToLive: 10_000, inflightTimeout: 1_000 });

    await cacheA.fetch('k', () => 1);
    // A fresh marker as if a peer were mid-regen.
    await storageA.setItem(markerKey('k'), { startedAt: Date.now() });

    await cacheA.delete('k');

    expect(await storageB.getItem(markerKey('k'))).toBeNull();
  });
});
