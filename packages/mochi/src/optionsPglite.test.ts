import { afterAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { MochiOptions, closeOptionsStorage, initOptionsStorage } from './options';

// Exercises the `{ pglite: instance }` storage path — embedded, no wire protocol. The caller owns the
// instance, so this test closes it itself and proves Mochi's teardown leaves it usable.
describe('MochiOptions on pglite storage', () => {
  let db: PGlite;

  afterAll(async () => {
    await closeOptionsStorage();
    initOptionsStorage(null);
    await db?.close();
  });

  test('roundtrips values and never closes the caller-owned instance', async () => {
    db = await PGlite.create();
    initOptionsStorage({ pglite: db });

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

  test('writes never interleave with a bun-boss transaction sharing the instance', async () => {
    const { fromPglite } = await import('bun-boss');
    initOptionsStorage({ pglite: db });
    // Warm the driver so the racing statement below is the write itself, not the serialized schema bootstrap.
    await MochiOptions.get('shared_key');

    // A queue-style BEGIN…ROLLBACK holds the per-instance lock; an options write landing inside it would silently
    // roll back with it. Serialized correctly, the write queues behind the transaction and survives.
    const rolledBack = fromPglite(db).withTransaction!(async (tx) => {
      await tx.executeSql('SELECT 1');
      await Bun.sleep(50);
      throw new Error('deliberate rollback');
    }).catch(() => {});
    const write = MochiOptions.update('shared_key', 'survives');
    await Promise.all([rolledBack, write]);

    expect(await MochiOptions.get('shared_key')).toBe('survives');
  }, 30_000);
});
