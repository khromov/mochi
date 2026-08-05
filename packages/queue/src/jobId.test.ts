import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createQueue } from './index';
import { waitFor } from './__fixtures__/testUtil';

test('an outstanding jobId deduplicates; after completion the id is reusable', async () => {
  let runs = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completions = 0;
  const queue = createQueue<null>('dedup', {
    process: async () => {
      runs++;
      await gate;
    },
    on: { completed: () => completions++ },
  });
  const first = await queue.add('j', null, { jobId: 'once' });
  expect(first.deduplicated).toBe(false);
  await waitFor(() => runs === 1);
  const dup = await queue.add('j', null, { jobId: 'once' });
  expect(dup).toEqual({ id: first.id, name: 'j', deduplicated: true });
  // The stored job's name wins over the colliding add's, so the ref never lies about what will run.
  const renamed = await queue.add('other-name', null, { jobId: 'once' });
  expect(renamed).toEqual({ id: first.id, name: 'j', deduplicated: true });
  release!();
  await waitFor(() => completions === 1);
  await Bun.sleep(100);
  expect(runs).toBe(1);

  await queue.add('j', null, { jobId: 'once' });
  await waitFor(() => runs === 2, 5000, 'reused id to run again');
  await queue.close();
});

test('jobIds are scoped per queue on a shared database', async () => {
  const sql = new SQL('sqlite://:memory:');
  const seen: string[] = [];
  const make = (name: string) =>
    createQueue<null>(name, {
      database: sql,
      process: (job) => {
        seen.push(`${job.queue}:${job.id}`);
      },
    });
  const a = make('scoped-a');
  const b = make('scoped-b');
  await a.add('j', null, { jobId: 'same' });
  await b.add('j', null, { jobId: 'same' });
  await waitFor(() => seen.length === 2);
  expect(seen.toSorted()).toEqual(['scoped-a:same', 'scoped-b:same']);
  await Promise.all([a.close(), b.close()]);
  await sql.close();
});
