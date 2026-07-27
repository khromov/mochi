import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorage, MemoryStorage } from './cache-storage';
import { SqlStorage } from './cache-storage-sql';
import { registerSweepable, sweepableCount, sweepAllRegistered, unregisterSweepable, type SweepableStorage } from './sweepRegistry';

const dirs: string[] = [];
const registered: SweepableStorage[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-sweepreg-'));
  dirs.push(dir);
  return dir;
}

function track<T extends SweepableStorage>(storage: T): T {
  registered.push(storage);
  return storage;
}

afterEach(() => {
  for (const storage of registered) {
    unregisterSweepable(storage);
  }
  registered.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('sweep registry', () => {
  test('sweeps every registered storage in one pass', async () => {
    const swept: string[] = [];
    registerSweepable(track({ sweepAndReport: () => void swept.push('a') }));
    registerSweepable(track({ sweepAndReport: async () => void swept.push('b') }));

    await sweepAllRegistered();

    expect(swept).toEqual(['a', 'b']);
  });

  test('one failing storage does not cost the others their pass', async () => {
    const swept: string[] = [];
    registerSweepable(
      track({
        sweepAndReport: () => {
          throw new Error('backend down');
        },
      }),
    );
    registerSweepable(track({ sweepAndReport: () => void swept.push('good') }));

    // Still swept, but the failure is re-thrown so the task runner reports it instead of the janitor going silent.
    await expect(sweepAllRegistered()).rejects.toThrow('backend down');
    expect(swept).toEqual(['good']);
  });

  test('reports several failures together', async () => {
    for (const name of ['one', 'two']) {
      registerSweepable(
        track({
          sweepAndReport: () => {
            throw new Error(name);
          },
        }),
      );
    }

    await expect(sweepAllRegistered()).rejects.toThrow('2 cache storages failed to sweep');
  });

  test('a storage that disposes mid-pass is not swept', async () => {
    const swept: string[] = [];
    const second: SweepableStorage = { sweepAndReport: () => void swept.push('second') };
    const first: SweepableStorage = {
      sweepAndReport: async () => {
        swept.push('first');
        unregisterSweepable(second);
      },
    };
    registerSweepable(track(first));
    registerSweepable(track(second));

    await sweepAllRegistered();

    expect(swept).toEqual(['first']);
  });

  test('each storage rejects the purgeInterval it replaced', () => {
    const expected = /`purgeInterval` was replaced by `purge`/;

    expect(() => new MemoryStorage({ purgeInterval: 0 } as never)).toThrow(expected);
    expect(() => new FileStorage({ directory: makeDir(), purgeInterval: 0 } as never)).toThrow(expected);
    expect(() => new SqlStorage({ url: `sqlite://${join(makeDir(), 'c.db')}`, purgeInterval: 0 } as never)).toThrow(expected);
  });

  test('FileStorage and SqlStorage join the sweep by default', async () => {
    const before = sweepableCount();

    const file = new FileStorage({ directory: makeDir() });
    const sql = new SqlStorage({ url: `sqlite://${join(makeDir(), 'joined.db')}` });
    expect(sweepableCount()).toBe(before + 2);

    file.dispose();
    await sql.dispose();
    expect(sweepableCount()).toBe(before);
  });
});
