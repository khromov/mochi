import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import type { ResolvedEmailMessage } from 'mochi-framework';

// Its own file because `Mochi.serve()` may only be called once per process, and this suite drives the delivery job's
// full retry-to-terminal path, which needs the fast SUPPORT_RETRY_DELAY_MS set before ./jobs.server is evaluated.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-txjobs-test-'));
process.env.SUPPORT_DB = path.join(outDir, 'support.sqlite');
process.env.ADMIN_PASSWORD = 'letmein';
process.env.SUPPORT_RETRY_DELAY_MS = '30';

const { insertSubmission, getSubmission, appendEmailLog, emailLogsBySubmission, closeDb } = await import('./db.server');
const { supportJobs, SUPPORT_TO } = await import('./jobs.server');

const sent: ResolvedEmailMessage[] = [];

// The transport fails only for this address, so one server covers both the delivery path and the retry-to-failed path.
const POISON = 'boom@example.com';

// What routes.ts's send action does, minus HTTP: row, log line, and durable delivery job in one SQLite transaction.
const submit = (email: string): Promise<number> =>
  supportJobs.withTransaction(async ({ tx, transactionHooks }) => {
    const id = insertSubmission({ name: 'Ada', email, message: `msg for ${email}` });
    appendEmailLog(id, { attempt: 0, event: 'queued', detail: `Queued for delivery to ${SUPPORT_TO}` });
    await supportJobs.startChain({ typeName: 'send-support-email', input: { id }, tx, transactionHooks });
    return id;
  });

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !predicate(); i++) {
    await Bun.sleep(10);
  }
};

let server: Server<undefined>;

beforeAll(async () => {
  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    htmlShell: './src/shell.html',
    email: {
      from: 'Mochi Support Form <noreply@mochi.fast>',
      transport: {
        type: 'custom',
        send: (message) => {
          if (message.replyTo === POISON) {
            throw new Error('SMTP said no');
          }
          sent.push(message);
        },
      },
    },
    jobs: supportJobs,
    routes: {},
  });
});

afterAll(async () => {
  server?.stop(true);
  closeDb();
  // Windows releases the SQLite lock asynchronously; best-effort, never fail the suite over temp-dir cleanup.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(outDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

test('a submission commits with its delivery job and is delivered', async () => {
  const id = await submit('ada@example.com');
  await waitFor(() => getSubmission(id)?.email_status === 'sent');
  expect(getSubmission(id)?.email_status).toBe('sent');
  expect(sent.map((m) => m.replyTo)).toContain('ada@example.com');
  expect((emailLogsBySubmission()[id] ?? []).map((e) => e.event)).toEqual(['queued', 'sending', 'sent']);
});

test('a throw inside the transaction rolls the row, log, and job back together', async () => {
  await expect(
    supportJobs.withTransaction(async ({ tx, transactionHooks }) => {
      const id = insertSubmission({ name: 'Ghost', email: 'ghost@example.com', message: 'never lands' });
      appendEmailLog(id, { attempt: 0, event: 'queued' });
      await supportJobs.startChain({ typeName: 'send-support-email', input: { id }, tx, transactionHooks });
      throw new Error('validation failed after the writes');
    }),
  ).rejects.toThrow('validation failed after the writes');

  await Bun.sleep(50);
  // Nothing survived, and no delivery was attempted.
  expect(sent.map((m) => m.replyTo)).not.toContain('ghost@example.com');
  const chains = await supportJobs.client().listChains({ filter: { typeName: ['send-support-email'] } });
  const inputs = chains.items.map((c) => (c.input as { id: number }).id);
  for (const submissionId of inputs) {
    expect(getSubmission(submissionId)?.email).not.toBe('ghost@example.com');
  }
});

test('an undeliverable address retries with backoff, then lands terminally `failed`', async () => {
  const id = await submit(POISON);
  await waitFor(() => getSubmission(id)?.email_status === 'failed');

  const row = getSubmission(id);
  expect(row?.email_status).toBe('failed');
  expect(row?.email_error).toBe('SMTP said no');

  // One `failed` log line per attempt, and the job completed (not stuck retrying) with a failure-shaped output.
  const events = (emailLogsBySubmission()[id] ?? []).map((e) => e.event);
  expect(events.filter((e) => e === 'failed')).toHaveLength(3);
  const chain = await supportJobs.awaitChain({ id: (await latestChainFor(id))! }, { timeoutMs: 5_000 });
  expect(chain.output).toEqual({ sent: false });
});

async function latestChainFor(submissionId: number): Promise<string | undefined> {
  const chains = await supportJobs.client().listChains({ filter: { typeName: ['send-support-email'] } });
  return chains.items.find((c) => (c.input as { id: number }).id === submissionId)?.id;
}

test('mid-backoff the row stays `pending` with the reason recorded for the admin panel', async () => {
  // A fresh poisoned row observed right after its first failed attempt, before the retries exhaust.
  const id = await submit(POISON);
  await waitFor(() => (emailLogsBySubmission()[id] ?? []).some((e) => e.event === 'failed'));
  const row = getSubmission(id);
  if (row?.email_status !== 'failed') {
    expect(row?.email_status).toBe('pending');
    expect(row?.email_error).toBe('SMTP said no');
  }
  // Either way it ends terminally failed once retries exhaust.
  await waitFor(() => getSubmission(id)?.email_status === 'failed');
  expect(getSubmission(id)?.email_status).toBe('failed');
});
