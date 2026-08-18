import { afterEach, describe, expect, test } from 'bun:test';
import { fromPglite } from 'bun-boss';
import './queue';
import { MochiOptions, closeOptionsStorage, initOptionsStorage } from './options';

// The pglite options driver must share the queue module's bun-boss: the adapter's per-instance lock is module-level,
// so a second bun-boss copy (an SSR bundle's own import) would let an options write interleave with an open queue
// transaction. These tests lock the sharing mechanism; optionsPglite.test.ts covers the no-queue fallback path.
const slot = globalThis as unknown as Record<string, unknown>;

afterEach(async () => {
  await closeOptionsStorage();
  initOptionsStorage(null);
});

describe('options ↔ queue bun-boss sharing', () => {
  test('importing the queue module pins its bun-boss copy for options to reuse', () => {
    expect((slot.__mochi_bun_boss__ as { fromPglite: unknown }).fromPglite).toBe(fromPglite);
  });

  test('the pglite options driver goes through the pinned bun-boss, not its own import', async () => {
    const instance = { query() {}, exec() {} };
    const adapted: unknown[] = [];
    const original = slot.__mochi_bun_boss__;
    slot.__mochi_bun_boss__ = {
      fromPglite: (db: unknown) => {
        adapted.push(db);
        return { executeSql: async () => ({ rows: [] }) };
      },
    };
    try {
      initOptionsStorage({ pglite: instance as never });
      expect(await MochiOptions.get('k')).toBeUndefined();
      expect(adapted).toEqual([instance]);
    } finally {
      slot.__mochi_bun_boss__ = original;
    }
  });
});
