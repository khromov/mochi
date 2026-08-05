import { expect, test } from 'bun:test';
import { createQueue } from './index';
import { waitFor } from './__fixtures__/testUtil';

test('delay defers the first run without relying on the poll tick', async () => {
  const runAt: number[] = [];
  const queue = createQueue<null>('delayed', {
    // Polling effectively off: the one-shot wake timer must fire the delayed job on time.
    pollInterval: 60_000,
    process: () => {
      runAt.push(Date.now());
    },
  });
  const added = Date.now();
  await queue.add('j', null, { delay: 400 });
  await Bun.sleep(150);
  expect(runAt).toHaveLength(0);
  await waitFor(() => runAt.length === 1, 3000, 'delayed job to run');
  expect(runAt[0]! - added).toBeGreaterThanOrEqual(380);
  expect(runAt[0]! - added).toBeLessThanOrEqual(2000);
  await queue.close();
});

test('lower priority value runs first, FIFO within a priority', async () => {
  const order: string[] = [];
  let release: (() => void) | undefined;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = createQueue<{ tag: string }>('prioritized', {
    concurrency: 1,
    process: async (job) => {
      if (job.data.tag === 'blocker') {
        await blocker;
        return;
      }
      order.push(job.data.tag);
    },
  });
  await queue.add('j', { tag: 'blocker' });
  await Bun.sleep(30);
  // Queued behind the blocker; distinct run_at values make FIFO deterministic.
  await queue.add('j', { tag: 'low-1' }, { priority: 5 });
  await Bun.sleep(2);
  await queue.add('j', { tag: 'high' }, { priority: 0 });
  await Bun.sleep(2);
  await queue.add('j', { tag: 'low-2' }, { priority: 5 });
  await Bun.sleep(2);
  release!();
  await waitFor(() => order.length === 3);
  expect(order).toEqual(['high', 'low-1', 'low-2']);
  await queue.close();
});
