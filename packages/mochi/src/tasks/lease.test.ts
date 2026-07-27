import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MemoryLeaseStore, SqlLeaseStore, type TaskLeaseStore } from './lease';

const tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-lease-test-'));
const stores: TaskLeaseStore[] = [];

afterAll(async () => {
  await Promise.allSettled(stores.map((s) => s.close()));
  rmSync(tmp, { recursive: true, force: true });
});

function track<T extends TaskLeaseStore>(store: T): T {
  stores.push(store);
  return store;
}

// Every backend must agree on the election rules — the point of the interface is that swapping stores can't change who wins.
const backends: [string, (name: string) => TaskLeaseStore][] = [
  ['MemoryLeaseStore', (name) => track(new MemoryLeaseStore(name))],
  ['SqlLeaseStore(sqlite)', (name) => track(new SqlLeaseStore({ url: `sqlite://${path.join(tmp, 'lease.db')}`, name }))],
];

const TTL = 1_000;
const claim = (owner: string, now: number, buildTime: number | null = 500) => ({
  owner,
  buildId: buildTime === null ? null : `build-${buildTime}`,
  buildTime,
  now,
  ttl: TTL,
});

for (const [label, make] of backends) {
  describe(label, () => {
    test('the first claimant wins and a fresh contender is refused', async () => {
      const store = make('t:first');
      expect((await store.tryAcquire(claim('A', 1_000))).acquired).toBe(true);

      const contender = await store.tryAcquire(claim('B', 1_010));
      expect(contender.acquired).toBe(false);
      expect(contender.holder?.owner).toBe('A');
    });

    test('the holder renews indefinitely without ever yielding', async () => {
      const store = make('t:renew');
      await store.tryAcquire(claim('A', 1_000));

      expect(await store.renew('A', 1_400)).toBe(true);
      // Renewal moved the heartbeat forward, so what would be past the TTL relative to the original acquisition is still inside it.
      expect((await store.tryAcquire(claim('B', 1_900))).acquired).toBe(false);
      expect((await store.read())?.owner).toBe('A');
    });

    test('an expired lease is taken over, and the deposed holder learns it from renew()', async () => {
      const store = make('t:expire');
      await store.tryAcquire(claim('A', 1_000));

      expect((await store.tryAcquire(claim('B', 1_000 + TTL + 1))).acquired).toBe(true);
      // The convergence guarantee: A learns it is no longer leader the next time it beats, rather than continuing to run the cluster's tasks.
      expect(await store.renew('A', 1_000 + TTL + 2)).toBe(false);
      expect((await store.read())?.owner).toBe('B');
    });

    test('a strictly newer build preempts immediately, an older one never does', async () => {
      const store = make('t:build');
      await store.tryAcquire(claim('A', 1_000, 500));

      // Well inside the TTL — only the build comparison can decide these.
      expect((await store.tryAcquire(claim('OLD', 1_010, 400))).acquired).toBe(false);
      expect((await store.tryAcquire(claim('SAME', 1_020, 500))).acquired).toBe(false);
      expect((await store.tryAcquire(claim('NEW', 1_030, 900))).acquired).toBe(true);
      expect((await store.read())?.owner).toBe('NEW');
    });

    test('an unknown build time never preempts, in either direction', async () => {
      const store = make('t:unknown-build');
      await store.tryAcquire(claim('A', 1_000, 500));
      // Claimant has no build identity (dev-mode image, no manifest).
      expect((await store.tryAcquire(claim('B', 1_010, null))).acquired).toBe(false);

      const holderless = make('t:unknown-holder');
      await holderless.tryAcquire(claim('A', 1_000, null));
      // Holder has none, so even a dated challenger must wait out the TTL.
      expect((await holderless.tryAcquire(claim('B', 1_010, 900))).acquired).toBe(false);
      expect((await holderless.tryAcquire(claim('B', 1_000 + TTL + 1, 900))).acquired).toBe(true);
    });

    test('release hands over at once instead of burning a TTL', async () => {
      const store = make('t:release');
      await store.tryAcquire(claim('A', 1_000));

      await store.release('A');
      expect(await store.read()).toBeNull();
      expect((await store.tryAcquire(claim('B', 1_005))).acquired).toBe(true);
    });

    test('release by a non-holder is ignored', async () => {
      const store = make('t:release-other');
      await store.tryAcquire(claim('A', 1_000));

      await store.release('B');
      expect((await store.read())?.owner).toBe('A');
    });

    test('renew on an empty lease reports failure rather than resurrecting it', async () => {
      const store = make('t:renew-empty');
      expect(await store.renew('A', 1_000)).toBe(false);
      expect(await store.read()).toBeNull();
    });

    test('the stored record round-trips its build identity', async () => {
      const store = make('t:record');
      await store.tryAcquire(claim('A', 1_234, 777));

      const record = await store.read();
      expect(record).toMatchObject({ owner: 'A', buildId: 'build-777', buildTime: 777, acquiredAt: 1_234, heartbeatAt: 1_234 });
    });

    test('separate lease names do not contend', async () => {
      const alpha = make('app:alpha');
      const beta = make('app:beta');

      expect((await alpha.tryAcquire(claim('A', 1_000))).acquired).toBe(true);
      expect((await beta.tryAcquire(claim('B', 1_000))).acquired).toBe(true);
    });
  });
}

describe('SqlLeaseStore', () => {
  test('rejects a table name that is not a plain identifier', () => {
    expect(() => new SqlLeaseStore({ url: `sqlite://${path.join(tmp, 'x.db')}`, table: 'lease; DROP TABLE users' })).toThrow(/plain SQL identifier/);
  });

  test('two independent connections to one file elect a single winner', async () => {
    const url = `sqlite://${path.join(tmp, 'shared.db')}`;
    const a = track(new SqlLeaseStore({ url, name: 'shared' }));
    const b = track(new SqlLeaseStore({ url, name: 'shared' }));

    const [first, second] = await Promise.all([a.tryAcquire(claim('A', 2_000)), b.tryAcquire(claim('B', 2_000))]);
    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1);
  });
});
