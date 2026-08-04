import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createQueue, type Queue } from './index';

function pair(sql: SQL): [Queue<null>, Queue<null>] {
  const make = () => createQueue<null>('recover', { database: sql, pollInterval: 0, process: () => {} });
  return [make(), make()];
}

test('exactly one of two concurrent instances wins the recovery lease', async () => {
  const sql = new SQL('sqlite://:memory:');
  const [a, b] = pair(sql);
  const results = await Promise.all([a.tryRecoveryLease(), b.tryRecoveryLease()]);
  expect(results.toSorted()).toEqual([false, true]);
  await Promise.all([a.close(), b.close()]);
  await sql.close();
});

test("a winner's lease blocks siblings until the TTL, then reopens", async () => {
  const sql = new SQL('sqlite://:memory:');
  const [a, b] = pair(sql);
  expect(await a.tryRecoveryLease(150)).toBe(true);
  expect(await b.tryRecoveryLease(150)).toBe(false);
  await Bun.sleep(200);
  expect(await b.tryRecoveryLease(150)).toBe(true);
  await Promise.all([a.close(), b.close()]);
  await sql.close();
});

test('releaseRecoveryLease reopens the lease immediately for a retry', async () => {
  const sql = new SQL('sqlite://:memory:');
  const [a, b] = pair(sql);
  expect(await a.tryRecoveryLease(60_000)).toBe(true);
  expect(await b.tryRecoveryLease(60_000)).toBe(false);
  await a.releaseRecoveryLease();
  expect(await b.tryRecoveryLease(60_000)).toBe(true);
  await Promise.all([a.close(), b.close()]);
  await sql.close();
});

test('leases are scoped per queue name', async () => {
  const sql = new SQL('sqlite://:memory:');
  const a = createQueue<null>('recover-a', { database: sql, pollInterval: 0, process: () => {} });
  const b = createQueue<null>('recover-b', { database: sql, pollInterval: 0, process: () => {} });
  expect(await a.tryRecoveryLease()).toBe(true);
  expect(await b.tryRecoveryLease()).toBe(true);
  await Promise.all([a.close(), b.close()]);
  await sql.close();
});
