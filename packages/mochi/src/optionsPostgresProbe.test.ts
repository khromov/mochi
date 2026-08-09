import { describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { stringify } from 'devalue';
import { MochiOptions, closeOptionsStorage, __testSetOptionsStorage } from './options';
import { startTestPostgres } from './__fixtures__/postgres/startTestPostgres';

// TEMPORARY DIAGNOSTIC FILE — delete once the Windows hang is understood. Every probe is raced against a
// short deadline so one wedged step reports itself instead of taking the whole file down.
const DEADLINE = 4000;

async function probe(label: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  try {
    const result = await Promise.race([fn(), Bun.sleep(DEADLINE).then(() => Promise.reject(new Error('HANG')))]);
    console.log(`[probe] OK   ${label} (${Date.now() - t0}ms) -> ${JSON.stringify(result)?.slice(0, 70)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[probe] ${message === 'HANG' ? 'HANG' : 'ERR '} ${label} (${Date.now() - t0}ms) ${message}`);
  }
}

// The driver's exact insert, including the two BIGINT `Date.now()` params the earlier probes left out.
async function rawDriverShape(label: string, options: Record<string, unknown>): Promise<void> {
  const pg = await startTestPostgres();
  const sql = new SQL(pg.url, options);
  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS mochi_options');
  await sql.unsafe(
    'CREATE TABLE IF NOT EXISTS mochi_options.options (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)',
  );
  const insert = (value: string) => {
    const now = Date.now();
    return sql`
      INSERT INTO mochi_options.options (key, value, created_at, updated_at) VALUES (${'k'}, ${stringify(value)}, ${now}, ${now})
      ON CONFLICT (key) DO NOTHING RETURNING key`;
  };
  await probe(`${label} driver-shaped INSERT, 1 row`, () => insert('first'));
  await probe(`${label} driver-shaped INSERT, 0 rows`, () => insert('second'));
  await sql.close().catch(() => {});
  await pg.close().catch(() => {});
}

describe('postgres wire probe', () => {
  test('characterises which step wedges', async () => {
    console.log(`[probe] bun ${Bun.version} on ${process.platform}`);

    await rawDriverShape('default', {});
    await rawDriverShape('prepare:false', { prepare: false });

    // Now the real driver, one call at a time, with the promise inspected directly — this separates
    // "MochiOptions.set() never settles" from "expect().rejects never settles".
    const pg = await startTestPostgres();
    __testSetOptionsStorage({ postgres: pg.url });
    console.log('[probe] ===== MochiOptions via the real driver =====');

    await probe('MochiOptions.get(missing)', () => MochiOptions.get('missing'));
    await probe('MochiOptions.set(k) first', () => MochiOptions.set('k', 'v1'));
    await probe('MochiOptions.set(k) duplicate — settle only, no matcher', () =>
      MochiOptions.set('k', 'v2').then(
        () => 'RESOLVED (unexpected)',
        (err) => `REJECTED: ${err instanceof Error ? err.message.slice(0, 40) : err}`,
      ),
    );
    await probe('MochiOptions.set(k) duplicate — through expect().rejects', async () => {
      await expect(MochiOptions.set('k', 'v3')).rejects.toThrow('the key already exists');
      return 'matcher returned';
    });
    await probe('MochiOptions.update(k)', () => MochiOptions.update('k', 'v4'));
    await probe('MochiOptions.delete(k)', () => MochiOptions.delete('k'));
    await probe('MochiOptions.delete(k) again', () => MochiOptions.delete('k'));

    await closeOptionsStorage();
    __testSetOptionsStorage(null);
    await pg.close().catch(() => {});
    expect(true).toBe(true);
  }, 240_000);
});
