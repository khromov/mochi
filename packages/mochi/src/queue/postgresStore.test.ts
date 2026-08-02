import { afterAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { PostgresQueueStore } from './postgresStore';
import { runStoreContract } from './storeContract';

// Postgres coverage lights up only where a database exists (locally or in CI with a service container);
// the same contract always runs against sqlite and memory regardless.
const url = process.env.MOCHI_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const tableName = `mochi_queue_test_${Math.floor(performance.now())}_${process.pid}`;

describe.skipIf(!url)('PostgresQueueStore', () => {
  afterAll(async () => {
    const sql = new SQL(url!);
    await sql`DROP TABLE IF EXISTS ${sql(tableName)}`;
    await sql.close();
  });

  test('satisfies the better-queue store contract', async () => {
    await runStoreContract(() => new PostgresQueueStore({ queue: 'contract', url, tableName }));
  });

  test('rejects a tableName that is not a plain identifier', () => {
    expect(() => new PostgresQueueStore({ queue: 'q', url, tableName: 'tasks; DROP TABLE users' })).toThrow(/plain SQL identifier/);
  });
});
