import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { SQL } from 'bun';
import { MochiOptions, closeOptionsStorage, initOptionsStorage } from './options';
import { rmWithRetry } from './__fixtures__/rmWithRetry';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-options-test-'));

let counter = 0;
function useSqlite(): string {
  const file = path.join(dataDir, `options-${counter++}.db`);
  initOptionsStorage({ sqlite: file });
  return file;
}

afterEach(async () => {
  await closeOptionsStorage();
  initOptionsStorage(null);
});

afterAll(() => rmWithRetry(dataDir));

describe('MochiOptions on sqlite storage', () => {
  test('get returns undefined for a missing key', async () => {
    useSqlite();
    expect(await MochiOptions.get('missing')).toBeUndefined();
  });

  test('get returns the fallback on a miss without writing it', async () => {
    useSqlite();
    expect(await MochiOptions.get('dark_mode', true)).toBe(true);
    expect(await MochiOptions.get('dark_mode')).toBeUndefined();
  });

  test('roundtrips rich values through devalue', async () => {
    useSqlite();
    const value = {
      when: new Date('2026-08-09T12:00:00Z'),
      tags: new Set(['a', 'b']),
      counts: new Map([['x', 1]]),
      big: 123n,
    };
    await MochiOptions.set('rich', value);
    const back = await MochiOptions.get<typeof value>('rich');
    expect(back?.when).toEqual(value.when);
    expect(back?.tags).toEqual(value.tags);
    expect(back?.counts).toEqual(value.counts);
    expect(back?.big).toBe(123n);
  });

  test('a stored null is a hit — the fallback does not apply', async () => {
    useSqlite();
    await MochiOptions.set('nothing', null);
    expect(await MochiOptions.get('nothing', 'fallback')).toBeNull();
  });

  test('set is insert-only and throws on an existing key, leaving the value unchanged', async () => {
    useSqlite();
    await MochiOptions.set('dark_mode', false);
    await expect(MochiOptions.set('dark_mode', true)).rejects.toThrow(
      'MochiOptions.set("dark_mode"): the key already exists. set() is insert-only — use MochiOptions.update() to overwrite, or delete() it first.',
    );
    expect(await MochiOptions.get('dark_mode')).toBe(false);
  });

  test('concurrent sets of one key let exactly one win', async () => {
    useSqlite();
    const results = await Promise.allSettled([MochiOptions.set('race', 1), MochiOptions.set('race', 2)]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(await MochiOptions.get('race')).toBeOneOf([1, 2]);
  });

  test('update upserts: inserts when absent, overwrites when present, preserving created_at', async () => {
    const file = useSqlite();
    await MochiOptions.update('theme', 'light');
    expect(await MochiOptions.get('theme')).toBe('light');

    const sql = new SQL(`sqlite://${file}`);
    const before = (await sql`SELECT created_at, updated_at FROM mochi_options WHERE key = 'theme'`) as Array<{ created_at: number; updated_at: number }>;
    await Bun.sleep(5);
    await MochiOptions.update('theme', 'dark');
    expect(await MochiOptions.get('theme')).toBe('dark');
    const after = (await sql`SELECT created_at, updated_at FROM mochi_options WHERE key = 'theme'`) as Array<{ created_at: number; updated_at: number }>;
    await sql.close();
    expect(after[0]?.created_at).toBe(before[0]!.created_at);
    expect(after[0]?.updated_at).toBeGreaterThan(before[0]!.updated_at);
  });

  test('modify inserts when the key is missing, passing undefined to fn', async () => {
    useSqlite();
    expect(await MochiOptions.modify<number>('views', (current) => (current ?? 0) + 1)).toBe(1);
    expect(await MochiOptions.get('views')).toBe(1);
  });

  test('modify transforms an existing value and supports an async fn', async () => {
    useSqlite();
    await MochiOptions.set('tags', new Set(['a']));
    const next = await MochiOptions.modify<Set<string>>('tags', async (current) => new Set([...(current ?? []), 'b']));
    expect(next).toEqual(new Set(['a', 'b']));
    expect(await MochiOptions.get('tags')).toEqual(new Set(['a', 'b']));
  });

  test('modify retries when another writer lands between its read and write', async () => {
    useSqlite();
    await MochiOptions.set('counter', 10);
    let runs = 0;
    const result = await MochiOptions.modify<number>('counter', async (current) => {
      runs++;
      if (runs === 1) {
        // An interloping plain update() must bump the version and force a re-read.
        await MochiOptions.update('counter', 100);
      }
      return (current ?? 0) + 1;
    });
    expect(runs).toBe(2);
    expect(result).toBe(101);
    expect(await MochiOptions.get('counter')).toBe(101);
  });

  test('concurrent modify increments all land — no lost updates', async () => {
    useSqlite();
    await Promise.all(Array.from({ length: 10 }, () => MochiOptions.modify<number>('hits', (current) => (current ?? 0) + 1)));
    expect(await MochiOptions.get('hits')).toBe(10);
  });

  test('modify rejects a non-function argument and an undefined result', async () => {
    useSqlite();
    await expect(MochiOptions.modify('k', undefined as never)).rejects.toThrow('MochiOptions.modify("k"): the second argument must be a function (current) => next.');
    await expect(MochiOptions.modify('k', () => undefined as never)).rejects.toThrow('MochiOptions.modify("k"): value must not be undefined');
    expect(await MochiOptions.get('k')).toBeUndefined();
  });

  test('delete reports whether a key existed', async () => {
    useSqlite();
    await MochiOptions.set('temp', 42);
    expect(await MochiOptions.delete('temp')).toBe(true);
    expect(await MochiOptions.delete('temp')).toBe(false);
    expect(await MochiOptions.get('temp')).toBeUndefined();
  });

  test('rejects undefined values and invalid keys', async () => {
    useSqlite();
    await expect(MochiOptions.set('u', undefined)).rejects.toThrow(
      'MochiOptions.set("u"): value must not be undefined — get() returns undefined for a missing key. Store null instead, or delete() the key.',
    );
    await expect(MochiOptions.update('u', undefined)).rejects.toThrow('value must not be undefined');
    await expect(MochiOptions.get('')).rejects.toThrow('MochiOptions.get(): key must be a non-empty string.');
    await expect(MochiOptions.delete('')).rejects.toThrow('MochiOptions.delete(): key must be a non-empty string.');
  });

  test('values persist across a storage close and reopen', async () => {
    const file = useSqlite();
    await MochiOptions.set('persistent', { kept: true });
    await closeOptionsStorage();
    initOptionsStorage({ sqlite: file });
    expect(await MochiOptions.get('persistent')).toEqual({ kept: true });
  });

  test('throws when Mochi.serve() has not been called and no storage is set', async () => {
    await expect(MochiOptions.get('dark_mode')).rejects.toThrow(
      'MochiOptions.get("dark_mode"): Mochi.serve() has not been called yet. Options become available once Mochi.serve({ optionsStorage }) runs.',
    );
  });

  test('throws when Mochi.serve() ran without optionsStorage configured', async () => {
    // Faked config singleton: booting a real Mochi.serve() here would wedge the one-per-process singleton for the file.
    const slot = globalThis as unknown as Record<string, unknown>;
    slot.__mochi_config__ = { options: {}, secretKey: Buffer.alloc(32) };
    try {
      await expect(MochiOptions.get('dark_mode')).rejects.toThrow('MochiOptions.get("dark_mode"): no optionsStorage is configured.');
    } finally {
      delete slot.__mochi_config__;
    }
  });
});
