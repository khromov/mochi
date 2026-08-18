import { afterAll, describe, expect, test } from 'bun:test';
import { MochiOptions, closeOptionsStorage, initOptionsStorage } from './options';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';

// Exercises the `{ postgres: url }` storage path over the wire protocol; the embedded path is covered by
// optionsPglite.test.ts and shared behavior by options.test.ts.
describe('MochiOptions on postgres storage', () => {
  let pg: TestPostgres;

  afterAll(async () => {
    await closeOptionsStorage();
    initOptionsStorage(null);
    await pg?.close();
  });

  test('installs its schema and roundtrips get/set/update/delete', async () => {
    pg = await startTestPostgres();
    initOptionsStorage({ postgres: pg.url });

    expect(await MochiOptions.get('missing')).toBeUndefined();
    await MochiOptions.set('site_name', 'Mochi');
    expect(await MochiOptions.get('site_name')).toBe('Mochi');

    // Caught by hand rather than with `expect().rejects`: on Bun 1.3.x for Windows that matcher wedges the
    // whole test process when the rejection arrives from a bun:sql round-trip (the same rejection observed
    // through catch settles in milliseconds). Fixed in Bun 1.4 — restore the matcher once that is the floor.
    let duplicateError = '';
    try {
      await MochiOptions.set('site_name', 'other');
    } catch (err) {
      duplicateError = err instanceof Error ? err.message : String(err);
    }
    expect(duplicateError).toContain('the key already exists');
    expect(await MochiOptions.get('site_name')).toBe('Mochi');

    await MochiOptions.update('site_name', { renamed: new Date('2026-01-01T00:00:00Z') });
    expect(await MochiOptions.get('site_name')).toEqual({ renamed: new Date('2026-01-01T00:00:00Z') });

    expect(await MochiOptions.delete('site_name')).toBe(true);
    expect(await MochiOptions.delete('site_name')).toBe(false);

    await Promise.all(Array.from({ length: 5 }, () => MochiOptions.modify<number>('hits', (current) => (current ?? 0) + 1)));
    expect(await MochiOptions.get('hits')).toBe(5);

    // The options table must live in the namespaced schema, not the user's public schema.
    const { rows } = await pg.query<{ table_schema: string }>("SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name = 'options'");
    expect(rows.map((r) => r.table_schema)).toEqual(['mochi_options']);
  }, 30_000);
});
