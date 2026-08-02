import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { createAsyncRwLock, createSqliteStateAdapter } from '@queuert/sqlite';
import { runStateAdapterConformance } from 'queuert/conformance';
import { defineJobTypes } from 'queuert';
import { Mochi } from './Mochi';
import { closeAllJobResources, mountJobs } from './jobs';
import type { MochiJobs, MochiJobsConfig, MochiJobsOptions } from './jobs';
import type { JobTypes } from 'queuert';
import { createBunSqliteStateProvider } from './jobs/sqliteProvider';
import { mochiEvents } from './events';
import { resetStartupMilestones } from './lifecycle';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-jobs-sqlite-'));

type EmailDefs = {
  'send-email': { entry: true; input: { id: number }; output: { sent: boolean } };
};

function emailJobs(overrides?: Partial<MochiJobsOptions<JobTypes<EmailDefs>>>): MochiJobs<EmailDefs> & MochiJobsConfig {
  return Mochi.jobs({
    types: defineJobTypes<EmailDefs>(),
    processors: {
      'send-email': {
        attemptHandler: async ({ job, complete }) => complete(async () => ({ sent: job.input.id > 0 })),
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

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('sqlite jobs backend', () => {
  test('the bun:sqlite provider passes queuert’s state adapter conformance suite', async () => {
    const report = await runStateAdapterConformance(async () => {
      const db = new Database(':memory:');
      db.run('PRAGMA auto_vacuum = INCREMENTAL');
      db.run('PRAGMA foreign_keys = ON');
      const stateAdapter = await createSqliteStateAdapter({
        stateProvider: createBunSqliteStateProvider({ db, lock: createAsyncRwLock() }),
      });
      await stateAdapter.migrateToLatest();
      return {
        stateAdapter,
        reset: async () => stateAdapter.truncate(),
        dispose: async () => {
          await stateAdapter.close();
          db.close();
        },
      };
    });
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThan(100);
  }, 60_000);

  test('mount creates the database file (and parent directory) and roundtrips a chain', async () => {
    const dbPath = path.join(dataDir, 'nested', 'jobs.sqlite');
    const jobs = emailJobs({ backend: { kind: 'sqlite', path: dbPath } });
    await mountJobs(jobs);
    expect(existsSync(dbPath)).toBe(true);

    const chain = await jobs.startChain({ typeName: 'send-email', input: { id: 7 } });
    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 10_000 });
    expect(done.output).toEqual({ sent: true });
  });

  test('a chain committed with domain writes rolls back atomically with them', async () => {
    const dbPath = path.join(dataDir, 'atomic.sqlite');
    const db = new Database(dbPath, { create: true });
    db.run('CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL)');

    const jobs = emailJobs({ backend: { kind: 'sqlite', database: db } });
    await mountJobs(jobs);

    await expect(
      jobs.withTransaction(async ({ tx, transactionHooks }) => {
        db.run("INSERT INTO tickets (subject) VALUES ('doomed')");
        await jobs.startChain({ typeName: 'send-email', input: { id: 1 }, tx, transactionHooks });
        throw new Error('constraint violated');
      }),
    ).rejects.toThrow('constraint violated');

    // Neither half survived: the domain row and the chain rolled back together.
    expect(db.query('SELECT count(*) AS n FROM tickets').get()).toEqual({ n: 0 });
    const chains = await jobs.client().listChains({ filter: { typeName: ['send-email'] } });
    expect(chains.items).toHaveLength(0);

    await closeAllJobResources();
    db.close();
  });

  test('a pending chain survives a restart and completes under the new runtime', async () => {
    const dbPath = path.join(dataDir, 'durable.sqlite');

    const first = emailJobs({ backend: { kind: 'sqlite', path: dbPath } });
    await mountJobs(first);
    // Scheduled far enough out that the first runtime never picks it up.
    const chain = await first.startChain({ typeName: 'send-email', input: { id: 42 }, schedule: { afterMs: 60_000 } });
    await closeAllJobResources();
    resetStartupMilestones();

    const second = emailJobs({ backend: { kind: 'sqlite', path: dbPath } });
    await mountJobs(second);
    const revived = await second.client().getChain({ id: chain.id });
    expect(revived?.status).toBe('pending');

    await second.withTransaction(async ({ tx, transactionHooks }) => {
      await second.client().rescheduleJob({ id: chain.id, transactionHooks, ...tx });
    });
    const done = await second.awaitChain({ id: chain.id }, { timeoutMs: 10_000 });
    expect(done.output).toEqual({ sent: true });
  });
});
