import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createQueue } from './index';
import { waitFor } from './__fixtures__/testUtil';

test('close waits for in-flight jobs and the shared SQL instance stays usable', async () => {
  const sql = new SQL('sqlite://:memory:');
  let completed = 0;
  let active = false;
  const queue = createQueue<null>('drain', {
    database: sql,
    process: async () => {
      active = true;
      await Bun.sleep(150);
      completed++;
    },
  });
  await queue.add('j', null);
  await waitFor(() => active);
  await queue.close();
  expect(completed).toBe(1);
  const rows: Array<{ one: number }> = await sql`SELECT 1 AS one`;
  expect(Number(rows[0]!.one)).toBe(1);
  await sql.close();
});

test('close stops claiming: a not-yet-due job stays pending', async () => {
  const sql = new SQL('sqlite://:memory:');
  let runs = 0;
  const queue = createQueue<null>('stop-claiming', {
    database: sql,
    pollInterval: 20,
    process: () => {
      runs++;
    },
  });
  await queue.add('j', null, { delay: 100 });
  await queue.close();
  await Bun.sleep(300);
  expect(runs).toBe(0);
  const rows: Array<{ status: string }> = await sql`SELECT status FROM mochi_jobs`;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.status).toBe('pending');
  await sql.close();
});

test('close is idempotent and returns the same settled promise', async () => {
  const queue = createQueue<null>('idem', { process: () => {} });
  const first = queue.close();
  const second = queue.close();
  expect(second).toBe(first);
  await first;
  await queue.close();
});

test('close honors its timeout and leaves the abandoned job leased for later reclaim', async () => {
  const sql = new SQL('sqlite://:memory:');
  let started = false;
  const queue = createQueue<null>('abandon', {
    database: sql,
    process: async () => {
      started = true;
      await Bun.sleep(60_000);
    },
  });
  await queue.add('j', null);
  await waitFor(() => started);
  const begun = Date.now();
  await queue.close({ timeout: 100 });
  expect(Date.now() - begun).toBeLessThan(2000);
  const rows: Array<{ status: string }> = await sql`SELECT status FROM mochi_jobs`;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.status).toBe('active');
  await sql.close();
});
