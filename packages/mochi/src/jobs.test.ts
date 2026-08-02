import { afterEach, describe, expect, test } from 'bun:test';
import { Mochi } from './Mochi';
import { closeAllJobResources, getJobs, mountJobs } from './jobs';
import type { MochiJobs, MochiJobsConfig, MochiJobsOptions } from './jobs';
import { defineJobTypes } from 'queuert';
import type { JobTypes } from 'queuert';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { markStartupMilestone, resetStartupMilestones } from './lifecycle';

type NotifyDefs = {
  'send-notification': {
    entry: true;
    input: { msg: string };
    continueWith: { typeName: 'record-receipt' };
  };
  'record-receipt': {
    input: { msg: string };
    output: { recorded: boolean };
  };
};

function notificationJobs(overrides?: Partial<MochiJobsOptions<JobTypes<NotifyDefs>>>): MochiJobs<NotifyDefs> & MochiJobsConfig {
  return Mochi.jobs({
    types: defineJobTypes<NotifyDefs>(),
    processors: {
      'send-notification': {
        attemptHandler: async ({ job, complete }) => complete(async ({ continueWith }) => continueWith({ typeName: 'record-receipt', input: { msg: job.input.msg } })),
      },
      'record-receipt': {
        attemptHandler: async ({ complete }) => complete(async () => ({ recorded: true })),
      },
    },
    ...overrides,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(async () => {
  mochiEvents.all.clear();
  resetStartupMilestones();
  initExtensions({});
  await closeAllJobResources();
});

describe('Mochi.jobs', () => {
  test('the descriptor is inert until mounted, then errors distinguish "too early" from "not mounted"', async () => {
    const jobs = notificationJobs();
    expect(jobs.__mochiJobs).toBe(true);
    // No serve() ran, so the milestone is unset and the lookup is legitimately "too early".
    await expect(jobs.startChain({ typeName: 'send-notification', input: { msg: 'x' } })).rejects.toThrow(/not mounted yet/);
    // Once the milestone is reached with no runtime, the message blames the missing serve option instead.
    markStartupMilestone('mochi:jobsMounted');
    await expect(jobs.startChain({ typeName: 'send-notification', input: { msg: 'x' } })).rejects.toThrow(/without a `jobs` option/);
  });

  test('roundtrips a two-step chain through continueWith on the memory backend', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'hello' } });
    expect(chain.id).toBeString();
    expect(chain.deduplicated).toBe(false);

    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 5_000 });
    expect(done.status).toBe('completed');
    expect(done.output).toEqual({ recorded: true });
  });

  test('emits queue:* events with queue = chain type and jobName = job type', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    const added: Array<{ queue: string; jobName: string }> = [];
    const active: Array<{ attempt: number }> = [];
    const completions: Array<{ queue: string; jobName: string; attempt: number; duration: number }> = [];
    const chainDone = deferred<void>();
    mochiEvents.on('queue:added', (e) => added.push(e));
    mochiEvents.on('queue:active', (e) => active.push(e));
    mochiEvents.on('queue:completed', (e) => {
      completions.push(e);
      if (e.jobName === 'record-receipt') {
        chainDone.resolve();
      }
    });

    const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'observed' } });
    await jobs.awaitChain({ id: chain.id }, { timeoutMs: 5_000 });
    await chainDone.promise;

    // Both chain steps surface: the entry job and the continueWith continuation.
    expect(added.map((e) => e.jobName)).toEqual(['send-notification', 'record-receipt']);
    expect(added.every((e) => e.queue === 'send-notification')).toBe(true);
    expect(active).toHaveLength(2);
    expect(active[0]?.attempt).toBe(1);
    expect(completions).toHaveLength(2);
    expect(completions.every((e) => e.duration >= 0)).toBe(true);
  });

  test('a throwing handler retries with backoff and reports queue:failed with the attempt and error', async () => {
    type FlakyDefs = {
      flaky: { entry: true; input: { failTimes: number }; output: { attempts: number } };
    };
    let runs = 0;
    const jobs = Mochi.jobs({
      types: defineJobTypes<FlakyDefs>(),
      retry: { initialDelayMs: 30, maxDelayMs: 100 },
      processors: {
        flaky: {
          attemptHandler: async ({ job, complete }) => {
            runs++;
            if (job.attempt < job.input.failTimes) {
              throw new Error(`boom ${job.attempt}`);
            }
            return complete(async () => ({ attempts: job.attempt }));
          },
        },
      },
    });
    await mountJobs(jobs);

    const failures: Array<{ attempt: number; error: string }> = [];
    mochiEvents.on('queue:failed', (e) => failures.push(e));

    const chain = await jobs.startChain({ typeName: 'flaky', input: { failTimes: 2 } });
    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 10_000 });

    expect(done.output).toEqual({ attempts: 2 });
    expect(runs).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.attempt).toBe(1);
    expect(failures[0]?.error).toBe('boom 1');
  });

  test('deduplication collapses identical keys onto the first chain', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    const first = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'dup' }, deduplication: { key: 'k1' } });
    const second = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'dup' }, deduplication: { key: 'k1' } });
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
  });

  test('withTransaction rolls the chain back when the callback throws', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    const added: unknown[] = [];
    mochiEvents.on('queue:added', (e) => added.push(e));

    let chainId = '';
    await expect(
      jobs.withTransaction(async ({ tx, transactionHooks }) => {
        const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'doomed' }, tx, transactionHooks });
        chainId = chain.id;
        throw new Error('domain write failed');
      }),
    ).rejects.toThrow('domain write failed');

    expect(chainId).toBeString();
    expect(await jobs.client().getChain({ id: chainId })).toBeUndefined();
    // The rolled-back chain must not have leaked a queue:added event.
    expect(added).toEqual([]);
  });

  test('startChain rejects a tx without transactionHooks', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);
    await expect(jobs.startChain({ typeName: 'send-notification', input: { msg: 'x' }, tx: {} })).rejects.toThrow(/together/);
  });

  test('getJobs() resolves the mounted handle; a second descriptor is rejected', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    const chain = await getJobs<NotifyDefs>().startChain({ typeName: 'send-notification', input: { msg: 'via-getJobs' } });
    expect(chain.id).toBeString();

    const stranger = notificationJobs();
    await expect(stranger.startChain({ typeName: 'send-notification', input: { msg: 'x' } })).rejects.toThrow(/not the one Mochi.serve/);
    await expect(mountJobs(stranger)).rejects.toThrow(/already mounted/);
  });

  test('jobs:leaseMs and jobs:pollIntervalMs are filtered with an explicit flag', async () => {
    const seen: Array<{ filter: string; value: number; explicit: boolean }> = [];
    initExtensions({
      filters: {
        'jobs:leaseMs': (value, { explicit }) => (seen.push({ filter: 'lease', value, explicit }), value),
        'jobs:pollIntervalMs': (value, { explicit }) => (seen.push({ filter: 'poll', value, explicit }), value),
      },
    });

    await mountJobs(notificationJobs({ leaseMs: 5_000 }));
    expect(seen).toEqual([
      { filter: 'lease', value: 5_000, explicit: true },
      { filter: 'poll', value: 2_000, explicit: false },
    ]);
  });

  test('a user log in the queuert client escape hatch composes with event emission', async () => {
    const types: string[] = [];
    const jobs = notificationJobs({ queuert: { client: { log: (entry: { type: string }) => types.push(entry.type) } } });
    await mountJobs(jobs);

    const completed = deferred<void>();
    mochiEvents.on('queue:completed', (e) => {
      if (e.jobName === 'record-receipt') {
        completed.resolve();
      }
    });
    const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'logged' } });
    await jobs.awaitChain({ id: chain.id }, { timeoutMs: 5_000 });
    await completed.promise;

    // Mochi's events fired (asserted above) AND the user log saw the raw entries.
    expect(types).toContain('job_created');
    expect(types).toContain('job_attempt_completed');
  });

  test('the sqlite backend refuses to mount without a path or database', async () => {
    const jobs = notificationJobs({ backend: { kind: 'sqlite' } });
    await expect(mountJobs(jobs)).rejects.toThrow(/needs a `path` or an existing `database`/);
  });

  test('closeAllJobResources drains the runtime and is idempotent', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);
    await closeAllJobResources();
    await expect(jobs.startChain({ typeName: 'send-notification', input: { msg: 'x' } })).rejects.toThrow(/not mounted/);
    await closeAllJobResources();
  });
});
