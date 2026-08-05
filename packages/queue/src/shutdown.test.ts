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

test('close waits for a claim already in flight and unclaims it before resolving', async () => {
  const real = new SQL('sqlite://:memory:');
  let releaseClaim: (() => void) | undefined;
  const claimGate = new Promise<void>((resolve) => (releaseClaim = resolve));
  let claimReached: (() => void) | undefined;
  const reachedClaim = new Promise<void>((resolve) => (claimReached = resolve));
  // Holds the claim statement mid-flight so close() runs while the pump is inside it.
  const sql = new Proxy(real, {
    apply(target, _thisArg, args: unknown[]) {
      const [first] = args;
      if (Array.isArray(first) && 'raw' in first && first.join('').includes("SET status = 'active'")) {
        return (async () => {
          claimReached!();
          await claimGate;
          return await Reflect.apply(target, target, args);
        })();
      }
      return Reflect.apply(target, target, args);
    },
    get(target, prop) {
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const events: string[] = [];
  const queue = createQueue<null>('close-mid-claim', {
    database: sql,
    pollInterval: 10_000,
    process: () => {
      events.push('ran');
    },
    on: { error: (err) => events.push(`error:${err.message}`) },
  });
  await queue.add('j', null);
  await reachedClaim;

  const closing = queue.close();
  releaseClaim!();
  await closing;

  // The claim was released without spending an attempt, the job never ran, and nothing errored after close.
  const rows: Array<{ status: string; attempts_made: number }> = await real`SELECT status, attempts_made FROM mochi_jobs`;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.status).toBe('pending');
  expect(Number(rows[0]!.attempts_made)).toBe(0);
  expect(events).toEqual([]);
  await real.close();
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
