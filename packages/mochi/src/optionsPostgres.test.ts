import { afterAll, describe, expect, test } from 'bun:test';
import { MochiOptions, closeOptionsStorage, __testSetOptionsStorage } from './options';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';

// TEMPORARY DIAGNOSTIC INSTRUMENTATION — remove once the Windows hang is understood.
const t0 = Date.now();
function step(label: string): void {
  console.log(`[diag +${Date.now() - t0}ms] ${label}`);
}

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
    step('starting test postgres');
    pg = await startTestPostgres();
    step('test postgres up');
    __testSetOptionsStorage({ postgres: pg.url });

    step('get(missing) — creates the driver and installs the schema');
    expect(await MochiOptions.get('missing')).toBeUndefined();
    step('set(site_name)');
    await MochiOptions.set('site_name', 'Mochi');
    step('get(site_name)');
    expect(await MochiOptions.get('site_name')).toBe('Mochi');
    step('set(site_name) again — expected to reject');
    await expect(MochiOptions.set('site_name', 'other')).rejects.toThrow('the key already exists');

    step('update(site_name)');
    await MochiOptions.update('site_name', { renamed: new Date('2026-01-01T00:00:00Z') });
    step('get(site_name) after update');
    expect(await MochiOptions.get('site_name')).toEqual({ renamed: new Date('2026-01-01T00:00:00Z') });

    step('delete(site_name)');
    expect(await MochiOptions.delete('site_name')).toBe(true);
    step('delete(site_name) again');
    expect(await MochiOptions.delete('site_name')).toBe(false);

    step('5 concurrent modify(hits)');
    await Promise.all(Array.from({ length: 5 }, () => MochiOptions.modify<number>('hits', (current) => (current ?? 0) + 1)));
    expect(await MochiOptions.get('hits')).toBe(5);

    // The options table must live in the namespaced schema, not the user's public schema.
    step('information_schema query');
    const { rows } = await pg.query<{ table_schema: string }>("SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name = 'options'");
    expect(rows.map((r) => r.table_schema)).toEqual(['mochi_options']);
  }, 30_000);
});
