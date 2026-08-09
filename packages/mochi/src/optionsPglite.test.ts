import { afterAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { MochiOptions, closeOptionsStorage, __testSetOptionsStorage } from './options';

// Exercises the `{ pglite: instance }` storage path — embedded, no wire protocol. The caller owns the
// instance, so this test closes it itself and proves Mochi's teardown leaves it usable.
describe('MochiOptions on pglite storage', () => {
  let db: PGlite;

  afterAll(async () => {
    await closeOptionsStorage();
    __testSetOptionsStorage(null);
    await db?.close();
  });

  test('roundtrips values and never closes the caller-owned instance', async () => {
    db = await PGlite.create();
    __testSetOptionsStorage({ pglite: db });

    await MochiOptions.set('features', new Set(['queues', 'options']));
    expect(await MochiOptions.get('features')).toEqual(new Set(['queues', 'options']));
    await MochiOptions.update('features', new Set(['options']));
    expect(await MochiOptions.get('features')).toEqual(new Set(['options']));
    expect(await MochiOptions.delete('features')).toBe(true);

    expect(await MochiOptions.modify<number>('hits', (current) => (current ?? 0) + 1)).toBe(1);
    expect(await MochiOptions.modify<number>('hits', (current) => (current ?? 0) + 1)).toBe(2);

    const { rows } = await db.query<{ table_schema: string }>("SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name = 'options'");
    expect(rows.map((r) => r.table_schema)).toEqual(['mochi_options']);

    await closeOptionsStorage();
    const { rows: after } = await db.query<{ ok: number }>('SELECT 1 AS ok');
    expect(after[0]?.ok).toBe(1);
  }, 30_000);
});
