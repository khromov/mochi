import { describe, it, expect, beforeEach } from 'bun:test';
import {
  registerDeferredIsland,
  unregisterDeferredIsland,
  reloadDeferredIsland,
  reloadDeferredIslandAll,
  isReloadingDeferredIsland,
  isReloadableIslandName,
  subscribeDeferredIsland,
  notifyDeferredIslandChange,
  type ReloadableIsland,
} from './deferInvalidation';

function stub(ok = true): ReloadableIsland & { reloads: number; busy: boolean } {
  return {
    reloads: 0,
    busy: false,
    reload() {
      this.reloads++;
      return Promise.resolve(ok);
    },
    isReloading() {
      return this.busy;
    },
  };
}

beforeEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  // Pinned too, so a previous test's subscriber would otherwise still hear this one.
  delete g.__mochi_deferred_islands__;
  delete g.__mochi_deferred_island_listeners__;
});

describe('deferInvalidation', () => {
  it('reloads every island sharing a name', async () => {
    const a = stub();
    const b = stub();
    registerDeferredIsland('pair', a);
    registerDeferredIsland('pair', b);

    await reloadDeferredIsland('pair');

    expect(a.reloads).toBe(1);
    expect(b.reloads).toBe(1);
  });

  it('resolves without throwing when the name is unknown', async () => {
    await expect(reloadDeferredIsland('missing')).resolves.toBeUndefined();
  });

  it('reloadDeferredIslandAll hits every registered island across names', async () => {
    const a = stub();
    const b = stub();
    const c = stub();
    registerDeferredIsland('one', a);
    registerDeferredIsland('two', b);
    registerDeferredIsland('two', c);

    await reloadDeferredIslandAll();

    expect(a.reloads).toBe(1);
    expect(b.reloads).toBe(1);
    expect(c.reloads).toBe(1);
  });

  it('unregister prunes an island so it no longer reloads', async () => {
    const a = stub();
    registerDeferredIsland('single', a);
    unregisterDeferredIsland('single', a);

    await reloadDeferredIsland('single');

    expect(a.reloads).toBe(0);
  });

  it('isReloadingDeferredIsland reports whether any island with the name is busy', () => {
    const a = stub();
    const b = stub();
    registerDeferredIsland('pair', a);
    registerDeferredIsland('pair', b);

    expect(isReloadingDeferredIsland('pair')).toBe(false);
    b.busy = true;
    expect(isReloadingDeferredIsland('pair')).toBe(true);
  });

  it('isReloadingDeferredIsland is false for an unknown name', () => {
    expect(isReloadingDeferredIsland('missing')).toBe(false);
  });

  // What `DeferReloadState` subscribes with — its reactivity is only as good as this.
  it('a per-name subscriber only hears its own name, and unsubscribes', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeDeferredIsland('mine', () => seen.push(1));

    notifyDeferredIslandChange('other');
    expect(seen).toEqual([]);
    notifyDeferredIslandChange('mine');
    expect(seen).toEqual([1]);

    unsubscribe();
    notifyDeferredIslandChange('mine');
    expect(seen).toEqual([1]);
  });

  it('waits for slow reloads before resolving', async () => {
    let done = false;
    const slow: ReloadableIsland = {
      isReloading: () => !done,
      reload: () =>
        new Promise((r) =>
          setTimeout(() => {
            done = true;
            r(true);
          }, 10),
        ),
    };
    registerDeferredIsland('slow', slow);

    await reloadDeferredIsland('slow');

    expect(done).toBe(true);
  });

  it('a round is only ok when every island sharing the name succeeded', async () => {
    registerDeferredIsland('mixed', stub(true));
    registerDeferredIsland('mixed', stub(false));
    registerDeferredIsland('good', stub(true));
    const changes: Array<{ ok?: boolean }> = [];
    const unsubMixed = subscribeDeferredIsland('mixed', (c) => changes.push(c));
    const unsubGood = subscribeDeferredIsland('good', (c) => changes.push(c));

    await reloadDeferredIsland('mixed');
    expect(changes.at(-1)).toEqual({ ok: false });

    await reloadDeferredIsland('good');
    expect(changes.at(-1)).toEqual({ ok: true });

    unsubMixed();
    unsubGood();
  });

  // Unsubscribers get called twice in real teardown paths; a stale one must not detach anyone else.
  it('a stale double-unsubscribe leaves a later subscriber attached', () => {
    const first = subscribeDeferredIsland('mine', () => {});
    first();

    const seen: number[] = [];
    const unsubscribe = subscribeDeferredIsland('mine', () => seen.push(1));
    first();

    notifyDeferredIslandChange('mine');
    expect(seen).toEqual([1]);
    unsubscribe();
  });

  it('isReloadableIslandName accepts only non-empty strings', () => {
    expect(isReloadableIslandName('cart')).toBe(true);
    expect(isReloadableIslandName('')).toBe(false);
    expect(isReloadableIslandName(5)).toBe(false);
    expect(isReloadableIslandName(undefined)).toBe(false);
    expect(isReloadableIslandName(null)).toBe(false);
  });
});
