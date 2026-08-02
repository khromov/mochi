import { afterAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { defineJobTypes } from 'queuert';
import type { JobTypes } from 'queuert';
import { Mochi } from './Mochi';
import { closeAllJobResources, mountJobs } from './jobs';
import type { MochiJobs, MochiJobsConfig, MochiJobsOptions } from './jobs';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';
import { resetStartupMilestones } from './lifecycle';

// Exercises the postgres jobs backend over the real wire protocol against an in-process PGlite Postgres. The pool is
// capped at ONE connection on purpose: PGlite is a single-session database and pglite-socket multiplexes extra clients
// at statement granularity, which would let concurrent statements interleave into an open transaction. With max: 1,
// Bun's pool does the serializing and every transaction genuinely owns the session. That same limit is why queuert's
// full conformance suite (whose read-isolation cases require two simultaneous connections) stays gated on TEST_PG_URL
// against a real server — see jobs/postgresProvider.test.ts.
//
// One runtime carries every job type and only the restart test remounts, keeping the file cheap (migrations apply DDL
// once). Per-test and awaitChain timeouts are sized so even a wedged wire call fails its own test and the file still
// finishes under run-tests' 60s per-file kill, reporting the real failure instead of "TIMED OUT (killed)".
const pg: TestPostgres = await startTestPostgres();
const sql = new SQL({ url: pg.url, max: 1 });

type PgJobDefs = {
  'send-notification': {
    entry: true;
    input: { msg: string };
    continueWith: { typeName: 'record-receipt' };
  };
  'record-receipt': {
    input: { msg: string };
    output: { recorded: boolean; echo: string };
  };
  flaky: { entry: true; input: { failTimes: number }; output: { attempts: number } };
};

function pgJobs(overrides?: Partial<MochiJobsOptions<JobTypes<PgJobDefs>>>): MochiJobs<PgJobDefs> & MochiJobsConfig {
  return Mochi.jobs({
    backend: { kind: 'postgres', sql },
    retry: { initialDelayMs: 50, maxDelayMs: 200 },
    types: defineJobTypes<PgJobDefs>(),
    processors: {
      'send-notification': {
        attemptHandler: async ({ job, complete }) => complete(async ({ continueWith }) => continueWith({ typeName: 'record-receipt', input: { msg: job.input.msg } })),
      },
      'record-receipt': {
        attemptHandler: async ({ job, complete }) => complete(async () => ({ recorded: true, echo: job.input.msg })),
      },
      flaky: {
        attemptHandler: async ({ job, complete }) => {
          if (job.attempt < job.input.failTimes) {
            throw new Error(`boom ${job.attempt}`);
          }
          return complete(async () => ({ attempts: job.attempt }));
        },
      },
    },
    ...overrides,
  });
}

afterAll(async () => {
  await closeAllJobResources();
  await sql.close().catch(() => {});
  await pg.close();
});

describe('postgres jobs backend (PGlite over the wire)', () => {
  const jobs = pgJobs();

  test('mounts, migrates, and roundtrips a two-step chain with structured payloads intact', async () => {
    await mountJobs(jobs);

    const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'hello-pg' } });
    expect(chain.deduplicated).toBe(false);

    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 12_000 });
    expect(done.status).toBe('completed');
    // A real object, not a serialized string — the regression this file exists for: jsonb params double-encoded
    // through unsafe() land as jsonb *strings* at rest and surface unparsed.
    expect(done.output).toEqual({ recorded: true, echo: 'hello-pg' });

    // Job state actually lives in Postgres, in real jsonb columns.
    const { rows } = await pg.query<{ jty: string; input: unknown }>(`SELECT jsonb_typeof(input) AS jty, input FROM queuert_job WHERE id = '${chain.id}'`);
    expect(rows[0]?.jty).toBe('object');
    expect(rows[0]?.input).toEqual({ msg: 'hello-pg' });
  }, 20_000);

  test('a chain committed via withTransaction rolls back atomically with the caller', async () => {
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
  }, 15_000);

  test('deduplication collapses identical keys across the wire', async () => {
    const first = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'dup' }, deduplication: { key: 'pg-dedup' } });
    const second = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'dup' }, deduplication: { key: 'pg-dedup' } });
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
  }, 15_000);

  test('a failing handler retries with backoff and the attempt counter persists in Postgres', async () => {
    const chain = await jobs.startChain({ typeName: 'flaky', input: { failTimes: 2 } });
    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 12_000 });
    expect(done.output).toEqual({ attempts: 2 });

    const { rows } = await pg.query<{ attempt: number }>(`SELECT attempt FROM queuert_job WHERE id = '${chain.id}'`);
    expect(Number(rows[0]?.attempt)).toBe(2);
  }, 20_000);

  test('a pending chain survives a runtime restart and completes under the new one', async () => {
    // Scheduled far enough out that the current runtime never picks it up.
    const chain = await jobs.startChain({ typeName: 'send-notification', input: { msg: 'durable' }, schedule: { afterMs: 120_000 } });
    await closeAllJobResources();
    resetStartupMilestones();

    const revived = pgJobs();
    await mountJobs(revived);
    const found = await revived.client().getChain({ id: chain.id });
    expect(found?.status).toBe('pending');

    await revived.withTransaction(async ({ tx, transactionHooks }) => {
      await revived.client().rescheduleJob({ id: chain.id, transactionHooks, ...tx });
    });
    const done = await revived.awaitChain({ id: chain.id }, { timeoutMs: 12_000 });
    expect(done.output).toEqual({ recorded: true, echo: 'durable' });
  }, 20_000);
});
