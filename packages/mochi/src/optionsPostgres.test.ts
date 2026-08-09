import { afterAll, describe, expect, test } from 'bun:test';
import { MochiOptions, closeOptionsStorage, __testSetOptionsStorage } from './options';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';

// Exercises the `{ postgres: url }` storage path over the wire protocol; the embedded path is covered by
// optionsPglite.test.ts and shared behavior by options.test.ts.
describe('MochiOptions on postgres storage', () => {
  let pg: TestPostgres;

  afterAll(async () => {
    await closeOptionsStorage();
    __testSetOptionsStorage(null);
    await pg?.close();
  });

  test('installs its schema and roundtrips get/set/update/delete', async () => {
    pg = await startTestPostgres();
    __testSetOptionsStorage({ postgres: pg.url });

    expect(await MochiOptions.get('missing')).toBeUndefined();
    await MochiOptions.set('site_name', 'Mochi');
    expect(await MochiOptions.get('site_name')).toBe('Mochi');
    await expect(MochiOptions.set('site_name', 'other')).rejects.toThrow('the key already exists');

    await MochiOptions.update('site_name', { renamed: new Date('2026-01-01T00:00:00Z') });
    expect(await MochiOptions.get('site_name')).toEqual({ renamed: new Date('2026-01-01T00:00:00Z') });

    expect(await MochiOptions.delete('site_name')).toBe(true);
    expect(await MochiOptions.delete('site_name')).toBe(false);

    // Kept sequential on purpose: the fixture serves one connection, so a concurrent query lands on one of
    // bun:sql's other pool sockets and wedges. Concurrent CAS is covered by optionsPglite.test.ts.
    expect(await MochiOptions.modify<number>('hits', (current) => (current ?? 0) + 1)).toBe(1);
    expect(await MochiOptions.modify<number>('hits', (current) => (current ?? 0) + 1)).toBe(2);

    // The options table must live in the namespaced schema, not the user's public schema.
    const { rows } = await pg.query<{ table_schema: string }>("SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name = 'options'");
    expect(rows.map((r) => r.table_schema)).toEqual(['mochi_options']);
  }, 30_000);
});
