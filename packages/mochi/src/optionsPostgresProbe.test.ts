import { describe, expect, test } from 'bun:test';
import { MochiOptions, closeOptionsStorage, __testSetOptionsStorage } from './options';
import { startTestPostgres } from './__fixtures__/postgres/startTestPostgres';

// TEMPORARY DIAGNOSTIC FILE — delete once the Windows hang is understood. Logs before and after every
// step, so a step that wedges the whole process (rather than merely never settling) is still pinpointed.
const DUPLICATE_MESSAGE = 'the key already exists';

function log(message: string): void {
  console.log(`[probe] ${message}`);
}

describe('postgres wire probe', () => {
  test('separates the matcher from the driver', async () => {
    log(`bun ${Bun.version} on ${process.platform}`);

    // Control 1: the matcher alone, no SQL anywhere, against the exact message shape (em dash included).
    log('A: before expect(Promise.reject).rejects.toThrow(string)');
    await expect(
      Promise.reject(new Error(`MochiOptions.set("k"): the key already exists. set() is insert-only — use MochiOptions.update() to overwrite, or delete() it first.`)),
    ).rejects.toThrow(DUPLICATE_MESSAGE);
    log('A: after');

    const pg = await startTestPostgres();
    __testSetOptionsStorage({ postgres: pg.url });
    log('B: driver pointed at postgres');

    await MochiOptions.set('k', 'v1');
    log('C: first set landed');

    // Duplicate #1 — settled by hand, no matcher.
    const outcome = await MochiOptions.set('k', 'v2').then(
      () => 'RESOLVED (unexpected)',
      (err: unknown) => `REJECTED: ${err instanceof Error ? err.message.slice(0, 40) : String(err)}`,
    );
    log(`D: duplicate #1 via then() -> ${outcome}`);

    // Duplicate #2 — settled by hand again, to test "does the Nth zero-row insert wedge?"
    const outcome2 = await MochiOptions.set('k', 'v3').then(
      () => 'RESOLVED (unexpected)',
      (err: unknown) => `REJECTED: ${err instanceof Error ? err.message.slice(0, 40) : String(err)}`,
    );
    log(`E: duplicate #2 via then() -> ${outcome2}`);

    // Duplicate #3 — try/catch instead of the matcher.
    let caught = '';
    try {
      await MochiOptions.set('k', 'v4');
    } catch (err) {
      caught = err instanceof Error ? err.message : String(err);
    }
    log(`F: duplicate #3 via try/catch -> ${caught.slice(0, 40)}`);

    // Duplicate #4 — through the matcher, which is where the previous run stopped dead.
    log('G: before expect(MochiOptions.set).rejects.toThrow');
    await expect(MochiOptions.set('k', 'v5')).rejects.toThrow(DUPLICATE_MESSAGE);
    log('G: after');

    log('H: cleaning up');
    await closeOptionsStorage();
    __testSetOptionsStorage(null);
    await pg.close().catch(() => {});
    log('H: done');
    expect(caught).toContain(DUPLICATE_MESSAGE);
  }, 120_000);
});
