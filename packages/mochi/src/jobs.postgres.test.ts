import { afterAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { defineJobTypes } from 'queuert';
import type { JobTypes } from 'queuert';
import { Mochi } from './Mochi';
import { closeAllJobResources, mountJobs } from './jobs';
import type { MochiJobs, MochiJobsConfig, MochiJobsOptions } from './jobs';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';
import { resetStartupMilestones } from './lifecycle';

// Tests the postgres jobs backend against PGlite: a real Postgres (compiled to WASM) running inside this process,
// reached over a local socket — so these tests speak the same wire protocol as production, with no server to install.
//
// `max: 1` limits Bun to a single database connection, because PGlite can only truly serve one. Ask it for more and
// pglite-socket fakes them by weaving everyone's queries onto the one real connection — and a query woven into the
// middle of someone else's open transaction is a recipe for corruption. With one connection, queries just wait their
// turn. The one thing this can't do is run two transactions at the same time, which is why queuert's full conformance
// suite (it tests exactly that) only runs against a real server — see jobs/postgresProvider.test.ts.
//
// Two things keep this file fast enough for the test runner's 60-second-per-file limit:
// - All tests share one mounted runtime instead of starting their own (only the restart test remounts, and by then the
//   tables already exist, so the extra mounts skip the table-creation work).
// - Every wait has a short deadline. If a query ever hangs, the affected test fails with a real error message instead
//   of the whole file dying as "TIMED OUT (killed)".
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
