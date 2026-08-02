import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import type { ResolvedEmailMessage } from 'mochi-framework';

// Its own file because `Mochi.serve()` may only be called once per process, and
// this suite needs the rows seeded *before* serve() runs its queue recovery.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-recover-test-'));
process.env.SUPPORT_DB = path.join(outDir, 'support.sqlite');
process.env.ADMIN_PASSWORD = 'letmein';

const { insertSubmission, getSubmission, markEmailFailed, markEmailSent, emailLogsBySubmission, undeliveredSubmissionIds, closeDb } = await import('./db.server');
const { SUPPORT_EMAIL_QUEUE, supportEmailQueue } = await import('./jobs.server');

const sent: ResolvedEmailMessage[] = [];

// The transport fails only for this address, so one server covers both the
// redelivery path and the still-retrying path.
const POISON = 'boom@example.com';

const seed = (email: string): number => insertSubmission({ name: 'Ada', email, message: `msg for ${email}` });

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 300 && !predicate(); i++) {
    await Bun.sleep(10);
  }
};

let server: Server<undefined>;
let stranded: { pending: number; failed: number; delivered: number; poisoned: number };

beforeAll(async () => {
  // Four rows in the states a restart can leave behind. Seeded before serve(),
  // so the queue's recover() sees them exactly as it would on a real boot.
  stranded = {
    pending: seed('never-attempted@example.com'),
    failed: seed('gave-up@example.com'),
    delivered: seed('already-sent@example.com'),
    poisoned: seed(POISON),
  };
  markEmailFailed(stranded.failed, 'Connection refused');
  markEmailSent(stranded.delivered);

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
    queues: { [SUPPORT_EMAIL_QUEUE]: supportEmailQueue },
    routes: {},
  });
});

afterAll(async () => {
  server?.stop(true);
  closeDb();
  // Windows releases the SQLite lock asynchronously; best-effort, never fail
  // the suite over temp-dir cleanup.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(outDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

test('a row stranded as `failed` is re-enqueued on boot and delivered', async () => {
  // The regression this file exists for: recover() used to select only `pending`, leaving an exhausted-retry row stranded forever.
  await waitFor(() => getSubmission(stranded.failed)?.email_status === 'sent');
  expect(getSubmission(stranded.failed)?.email_status).toBe('sent');
  expect(sent.map((m) => m.replyTo)).toContain('gave-up@example.com');
  // The old error is cleared once it actually lands.
  expect(getSubmission(stranded.failed)?.email_error).toBeNull();
});

test('a row still `pending` is re-enqueued too', async () => {
  await waitFor(() => getSubmission(stranded.pending)?.email_status === 'sent');
  expect(getSubmission(stranded.pending)?.email_status).toBe('sent');
});

test('an already-delivered row is left alone', () => {
  expect(sent.map((m) => m.replyTo)).not.toContain('already-sent@example.com');
  expect(emailLogsBySubmission()[stranded.delivered] ?? []).toEqual([]);
});

test('recovery logs a `requeued` entry for each row it puts back', () => {
  const events = (emailLogsBySubmission()[stranded.failed] ?? []).map((e) => e.event);
  expect(events[0]).toBe('requeued');
});

test('a failing attempt that the queue will retry leaves the row recoverable', async () => {
  // Mid-backoff the row must stay `pending`: marking it `failed` here is what
  // used to drop it out of the set recover() re-enqueues.
  await waitFor(() => (emailLogsBySubmission()[stranded.poisoned] ?? []).some((e) => e.event === 'failed'));
  const row = getSubmission(stranded.poisoned);
  expect(row?.email_status).toBe('pending');
  // The reason is still recorded, so the admin panel can show it while retrying.
  expect(row?.email_error).toBe('SMTP said no');
  expect(undeliveredSubmissionIds()).toContain(stranded.poisoned);
});
