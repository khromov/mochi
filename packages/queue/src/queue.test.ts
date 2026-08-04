import { describe, expect, test } from 'bun:test';
import { createQueue, type Job, type JobRunInfo } from './index';
import { waitFor } from './__fixtures__/testUtil';

describe('createQueue basics', () => {
  test('processes an added job end to end with a plain data job object', async () => {
    const seen: Job<{ n: number }>[] = [];
    const results: number[] = [];
    const queue = createQueue<{ n: number }, number>('roundtrip', {
      process: (job) => {
        seen.push(job);
        return job.data.n * 2;
      },
      on: { completed: (_job, result) => results.push(result) },
    });
    const ref = await queue.add('double', { n: 21 });
    await waitFor(() => results.length === 1);
    expect(results).toEqual([42]);
    expect(ref.name).toBe('double');
    expect(ref.id).toBeString();
    expect(seen[0]).toEqual({ id: ref.id, name: 'double', data: { n: 21 }, queue: 'roundtrip', attempt: 1, enqueuedAt: expect.any(Number) });
    await queue.close();
  });

  test('addBulk processes every job and returns one ref per job', async () => {
    const done: string[] = [];
    const queue = createQueue<{ v: string }>('bulk', {
      concurrency: 3,
      process: (job) => {
        done.push(job.data.v);
      },
    });
    const refs = await queue.addBulk([
      { name: 'j', data: { v: 'a' } },
      { name: 'j', data: { v: 'b' } },
      { name: 'j', data: { v: 'c' } },
    ]);
    expect(refs).toHaveLength(3);
    expect(new Set(refs.map((r) => r.id)).size).toBe(3);
    await waitFor(() => done.length === 3);
    expect(done.toSorted()).toEqual(['a', 'b', 'c']);
    await queue.close();
  });

  test('concurrency bounds simultaneous processors', async () => {
    let inFlight = 0;
    let peak = 0;
    let completed = 0;
    const queue = createQueue<null>('semaphore', {
      concurrency: 2,
      on: { completed: () => completed++ },
      process: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Bun.sleep(40);
        inFlight--;
      },
    });
    await queue.addBulk(Array.from({ length: 6 }, () => ({ name: 'j', data: null })));
    await waitFor(() => completed === 6);
    expect(peak).toBe(2);
    await queue.close();
  });

  test('listeners fire active before completed, with a positive duration', async () => {
    const order: string[] = [];
    let info: JobRunInfo | undefined;
    const queue = createQueue<null, string>('listeners', {
      process: async () => {
        await Bun.sleep(20);
        return 'ok';
      },
      on: {
        active: () => order.push('active'),
        completed: (_job, result, i) => {
          order.push(`completed:${result}`);
          info = i;
        },
      },
    });
    await queue.add('j', null);
    await waitFor(() => order.length === 2);
    expect(order).toEqual(['active', 'completed:ok']);
    expect(info!.duration).toBeGreaterThan(10);
    await queue.close();
  });

  test('a throwing listener is contained and reported via the error listener', async () => {
    const errors: Error[] = [];
    let completions = 0;
    const queue = createQueue<null>('bad-listener', {
      process: () => {},
      on: {
        completed: () => {
          completions++;
          throw new Error('listener boom');
        },
        error: (err) => errors.push(err),
      },
    });
    await queue.add('j', null);
    await queue.add('j', null);
    await waitFor(() => completions === 2 && errors.length === 2);
    expect(errors[0]!.message).toBe('listener boom');
    await queue.close();
  });

  test('add on a closed queue throws', async () => {
    const queue = createQueue<null>('closed', { process: () => {} });
    await queue.close();
    expect(queue.add('j', null)).rejects.toThrow('Queue "closed" is closed.');
  });
});
