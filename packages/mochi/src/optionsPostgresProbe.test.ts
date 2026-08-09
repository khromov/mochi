import { describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { startTestPostgres } from './__fixtures__/postgres/startTestPostgres';

// TEMPORARY DIAGNOSTIC FILE — delete once the Windows hang is understood. Every probe is raced against a
// short deadline so one wedged query reports itself instead of taking the whole file down.
const DEADLINE = 4000;

async function probe(label: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  try {
    const result = await Promise.race([fn(), Bun.sleep(DEADLINE).then(() => Promise.reject(new Error('HANG')))]);
    console.log(`[probe] OK   ${label} (${Date.now() - t0}ms) -> ${JSON.stringify(result)?.slice(0, 60)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[probe] ${message === 'HANG' ? 'HANG' : 'ERR '} ${label} (${Date.now() - t0}ms) ${message}`);
  }
}

async function runSuite(label: string, options: Record<string, unknown>): Promise<void> {
  const pg = await startTestPostgres();
  const sql = new SQL(pg.url, options);
  console.log(`[probe] ===== ${label} =====`);

  await probe(`${label} unsafe SELECT 1`, () => sql.unsafe('SELECT 1 AS one'));
  await probe(`${label} unsafe DDL`, () => sql.unsafe('CREATE TABLE o (key TEXT PRIMARY KEY, value TEXT NOT NULL)'));

  await probe(`${label} tagged SELECT, 0 rows, first`, () => sql`SELECT value FROM o WHERE key = ${'missing'}`);
  await probe(`${label} tagged SELECT, 0 rows, cached`, () => sql`SELECT value FROM o WHERE key = ${'missing'}`);

  await probe(`${label} INSERT..DO NOTHING RETURNING, 1 row`, () => sql`INSERT INTO o (key, value) VALUES (${'a'}, ${'1'}) ON CONFLICT (key) DO NOTHING RETURNING key`);
  await probe(`${label} INSERT..DO NOTHING RETURNING, 0 rows`, () => sql`INSERT INTO o (key, value) VALUES (${'a'}, ${'2'}) ON CONFLICT (key) DO NOTHING RETURNING key`);

  await probe(`${label} tagged SELECT, 1 row, first`, () => sql`SELECT value FROM o WHERE key = ${'a'}`);
  await probe(`${label} tagged SELECT, 1 row, cached`, () => sql`SELECT value FROM o WHERE key = ${'a'}`);

  await probe(`${label} UPDATE..RETURNING, 0 rows`, () => sql`UPDATE o SET value = ${'x'} WHERE key = ${'nope'} RETURNING key`);
  await probe(`${label} DELETE..RETURNING, 1 row`, () => sql`DELETE FROM o WHERE key = ${'a'} RETURNING key`);
  await probe(`${label} DELETE..RETURNING, 0 rows`, () => sql`DELETE FROM o WHERE key = ${'a'} RETURNING key`);

  // Does the connection simply die after N statements, whatever their shape?
  let reached = 0;
  await probe(`${label} 30 sequential SELECTs`, async () => {
    for (let i = 0; i < 30; i++) {
      await sql`SELECT ${i}::int AS n`;
      reached = i + 1;
    }
    return 'all 30';
  });
  console.log(`[probe] sequential SELECTs reached ${reached}/30`);

  await sql.close().catch(() => {});
  await pg.close().catch(() => {});
}

describe('postgres wire probe', () => {
  test('characterises which statement shapes settle', async () => {
    console.log(`[probe] bun ${Bun.version} on ${process.platform}`);
    await runSuite('default', {});
    await runSuite('prepare:false', { prepare: false });
    await runSuite('max:1', { max: 1 });
    expect(true).toBe(true);
  }, 240_000);
});
