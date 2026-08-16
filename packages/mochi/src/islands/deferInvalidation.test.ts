import { describe, it, expect, beforeEach } from 'bun:test';
import { registerDeferredIsland, unregisterDeferredIsland, reloadDeferredIsland, reloadDeferredIslandAll, type ReloadableIsland } from './deferInvalidation';

function stub(): ReloadableIsland & { reloads: number } {
  return {
    reloads: 0,
    reload() {
      this.reloads++;
      return Promise.resolve();
    },
  };
}

beforeEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__mochi_deferred_islands__;
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

  it('waits for slow reloads before resolving', async () => {
    let done = false;
    const slow: ReloadableIsland = {
      reload: () =>
        new Promise((r) =>
          setTimeout(() => {
            done = true;
            r();
          }, 10),
        ),
    };
    registerDeferredIsland('slow', slow);

    await reloadDeferredIsland('slow');

    expect(done).toBe(true);
  });
});
