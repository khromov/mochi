import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryStorage } from './cache-storage';
import { sweepableCount } from './sweepRegistry';
import { mochiEvents } from '../events';

const wait = Bun.sleep;

// Track every store a test creates so we can dispose its background timer.
const created: MemoryStorage[] = [];

function makeStorage(options: ConstructorParameters<typeof MemoryStorage>[0] = {}): MemoryStorage {
  const storage = new MemoryStorage(options);
  created.push(storage);
  return storage;
}

afterEach(() => {
  mochiEvents.all.clear();
  for (const storage of created) {
    storage.dispose();
  }
  created.length = 0;
});

describe('MemoryStorage', () => {
  test('round-trips get/set/remove/clear', async () => {
    const storage = makeStorage();

    expect(await storage.getItem('missing')).toBeNull();

    await storage.setItem('a', { value: 1 });
    expect(await storage.getItem('a')).toEqual({ value: 1 });

    await storage.removeItem('a');
    expect(await storage.getItem('a')).toBeNull();

    await storage.setItem('b', { value: 2 });
    await storage.setItem('c', { value: 3 });
    await storage.clear();
    expect(await storage.getItem('b')).toBeNull();
    expect(await storage.getItem('c')).toBeNull();
  });

  test('sweep is a no-op when maxAge is not configured', async () => {
    const storage = makeStorage();
    await storage.setItem('k', { value: 1 });

    expect(storage.sweep(Date.now() + 1_000_000)).toEqual({ removed: 0 });
    expect(await storage.getItem('k')).not.toBeNull();
  });

  test('sweep removes entries older than maxAge and keeps fresh ones', async () => {
    const storage = makeStorage({ maxAge: 50 });
    await storage.setItem('k', { value: 1 });

    // Nothing expired yet.
    expect(storage.sweep()).toEqual({ removed: 0 });
    expect(await storage.getItem('k')).not.toBeNull();

    // Advance the clock past maxAge relative to the entry's write time.
    const swept = storage.sweep(Date.now() + 1_000);
    expect(swept.removed).toBe(1);
    expect(await storage.getItem('k')).toBeNull();
  });

  test('sweep reports the keys it removed when asked', async () => {
    const storage = makeStorage({ maxAge: 50 });
    await storage.setItem('alpha', { value: 1 });
    await storage.setItem('beta', { value: 2 });

    const swept = storage.sweep(Date.now() + 1_000, { reportKeys: true });
    expect(swept.removed).toBe(2);
    expect(swept.removedKeys?.toSorted()).toEqual(['alpha', 'beta']);
  });

  test('sweep omits removedKeys unless reportKeys is set', async () => {
    const storage = makeStorage({ maxAge: 50 });
    await storage.setItem('alpha', { value: 1 });

    expect(storage.sweep(Date.now() + 1_000).removedKeys).toBeUndefined();
  });

  test('sweepAndReport reclaims aged entries and emits cache:sweep', async () => {
    const events: number[] = [];
    mochiEvents.on('cache:sweep', ({ removed }) => events.push(removed));

    const storage = makeStorage({ maxAge: 5 });
    await storage.setItem('k', { value: 1 });
    await wait(20);

    storage.sweepAndReport();

    expect(events).toEqual([1]);
    expect(await storage.getItem('k')).toBeNull();
  });

  test('joins the shared sweep only with a maxAge, and leaves it on dispose', () => {
    const before = sweepableCount();

    // No maxAge means `sweep()` can never remove anything, so joining would cost the janitor a pass over a definitional no-op.
    makeStorage();
    expect(sweepableCount()).toBe(before);

    const swept = makeStorage({ maxAge: 5 });
    expect(sweepableCount()).toBe(before + 1);

    makeStorage({ maxAge: 5, purge: false });
    expect(sweepableCount()).toBe(before + 1);

    swept.dispose();
    expect(sweepableCount()).toBe(before);
  });
});
