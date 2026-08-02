import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { defineJobTypes } from 'queuert';
import type { JobTypes } from 'queuert';
import { Mochi } from './Mochi';
import { closeAllJobResources, mountJobs } from './jobs';
import type { MochiJobs, MochiJobsConfig, MochiJobsOptions } from './jobs';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';
import { mochiEvents } from './events';
import { resetStartupMilestones } from './lifecycle';

// Exercises the postgres jobs backend over the real wire protocol against an in-process PGlite Postgres. The pool is
// capped at ONE connection on purpose: PGlite is a single-session database and pglite-socket multiplexes extra clients
// at statement granularity, which would let concurrent statements interleave into an open transaction. With max: 1,
// Bun's pool does the serializing and every transaction genuinely owns the session. That same limit is why queuert's
// full conformance suite (whose read-isolation cases require two simultaneous connections) stays gated on TEST_PG_URL
// against a real server — see jobs/postgresProvider.test.ts.
const pg: TestPostgres = await startTestPostgres();
const sql = new SQL({ url: pg.url, max: 1 });

type NotifyDefs = {
  'send-notification': {
    entry: true;
    input: { msg: string };
    continueWith: { typeName: 'record-receipt' };
  };
  'record-receipt': {
    input: { msg: string };
    output: { recorded: boolean; echo: string };
  };
};

function notificationJobs(overrides?: Partial<MochiJobsOptions<JobTypes<NotifyDefs>>>): MochiJobs<NotifyDefs> & MochiJobsConfig {
  return Mochi.jobs({
    backend: { kind: 'postgres', sql },
    types: defineJobTypes<NotifyDefs>(),
    processors: {
      'send-notification': {
        attemptHandler: async ({ job, complete }) => complete(async ({ continueWith }) => continueWith({ typeName: 'record-receipt', input: { msg: job.input.msg } })),
      },
      'record-receipt': {
        attemptHandler: async ({ job, complete }) => complete(async () => ({ recorded: true, echo: job.input.msg })),
      },
    },
    ...overrides,
  });
}

afterEach(async () => {
  mochiEvents.all.clear();
  resetStartupMilestones();
  await closeAllJobResources();
});

afterAll(async () => {
  await sql.close().catch(() => {});
  await pg.close();
});

describe('postgres jobs backend (PGlite over the wire)', () => {
  test('mounts, migrates, and roundtrips a two-step chain with structured payloads intact', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'hello-pg' } });
    expect(chain.deduplicated).toBe(false);

    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 20_000 });
    expect(done.status).toBe('completed');
    // A real object, not a serialized string — the regression this file exists for: jsonb params double-encoded
    // through unsafe() land as jsonb *strings* at rest and surface unparsed.
    expect(done.output).toEqual({ recorded: true, echo: 'hello-pg' });

    // Job state actually lives in Postgres, in real jsonb columns.
    const { rows } = await pg.query<{ jty: string; input: unknown }>(`SELECT jsonb_typeof(input) AS jty, input FROM queuert_job WHERE id = '${chain.id}'`);
    expect(rows[0]?.jty).toBe('object');
    expect(rows[0]?.input).toEqual({ msg: 'hello-pg' });
  });

  test('a chain committed via withTransaction rolls back atomically with the caller', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    let chainId = '';
    await expect(
      jobs.withTransaction(async ({ tx, transactionHooks }) => {
        const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'doomed' }, tx, transactionHooks });
        chainId = chain.id;
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');

    expect(chainId).toBeString();
    expect(await jobs.client().getChain({ id: chainId })).toBeUndefined();
    const { rows } = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM queuert_job WHERE id = '${chainId}'`);
    expect(rows[0]?.n).toBe('0');
  });

  test('deduplication collapses identical keys across the wire', async () => {
    const jobs = notificationJobs();
    await mountJobs(jobs);

    const first = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'dup' }, deduplication: { key: 'pg-dedup' } });
    const second = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'dup' }, deduplication: { key: 'pg-dedup' } });
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
  });

  test('a pending chain survives a runtime restart and completes under the new one', async () => {
    const first = notificationJobs();
    await mountJobs(first);
    // Scheduled far enough out that the first runtime never picks it up.
    const chain = await first.startChain({ typeName: 'send-notification', input: { msg: 'durable' }, schedule: { afterMs: 60_000 } });
    await closeAllJobResources();
    resetStartupMilestones();

    const second = notificationJobs();
    await mountJobs(second);
    const revived = await second.client().getChain({ id: chain.id });
    expect(revived?.status).toBe('pending');

    await second.withTransaction(async ({ tx, transactionHooks }) => {
      await second.client().rescheduleJob({ id: chain.id, transactionHooks, ...tx });
    });
    const done = await second.awaitChain({ id: chain.id }, { timeoutMs: 20_000 });
    expect(done.output).toEqual({ recorded: true, echo: 'durable' });
  });

  test('a failing handler retries with backoff and the attempt counter persists in Postgres', async () => {
    type FlakyDefs = { flaky: { entry: true; input: { failTimes: number }; output: { attempts: number } } };
    const jobs = Mochi.jobs({
      backend: { kind: 'postgres', sql },
      retry: { initialDelayMs: 50, maxDelayMs: 200 },
      types: defineJobTypes<FlakyDefs>(),
      processors: {
        flaky: {
          attemptHandler: async ({ job, complete }) => {
            if (job.attempt < job.input.failTimes) {
              throw new Error(`boom ${job.attempt}`);
            }
            return complete(async () => ({ attempts: job.attempt }));
          },
        },
      },
    });
    await mountJobs(jobs);

    const chain = await jobs.startChain({ typeName: 'flaky', input: { failTimes: 2 } });
    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 20_000 });
    expect(done.output).toEqual({ attempts: 2 });

    const { rows } = await pg.query<{ attempt: number; last_attempt_error: string | null }>(`SELECT attempt, last_attempt_error FROM queuert_job WHERE id = '${chain.id}'`);
    expect(Number(rows[0]?.attempt)).toBe(2);
  });
});
