import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import type { ResolvedEmailMessage } from 'mochi-framework';

// Its own file because `Mochi.serve()` may only be called once per process, and
// this suite needs the rows seeded *before* serve() runs its queue recovery.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-newsletter-recover-test-'));
process.env.SUPPORT_DB = path.join(outDir, 'support.sqlite');
process.env.MOCHI_ORIGIN = 'https://support.test';

const { requestSubscription, confirmSubscriber, getSubscriber, markNewsletterEmailSent, newsletterLogsBySubscriber, pendingConfirmationIds, closeDb } = await import('./db.server');
const { NEWSLETTER_EMAIL_QUEUE, newsletterEmailQueue } = await import('./newsletter/jobs.server');

const sent: ResolvedEmailMessage[] = [];

const DAY_MS = 24 * 60 * 60 * 1000;

const seed = (email: string, ttlMs = DAY_MS): number => {
  const outcome = requestSubscription({ email, source: 'test' }, { cooldownMs: 0, ttlMs });
  return outcome.id;
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 300 && !predicate(); i++) {
    await Bun.sleep(10);
  }
};

let server: Server<undefined>;
let stranded: { pending: number; expired: number; confirmed: number; delivered: number };

beforeAll(async () => {
  // The four states a restart can leave a signup in.
  stranded = {
    pending: seed('waiting@example.com'),
    // A negative TTL back-dates the expiry — the row is stale before it is read.
    expired: seed('stale@example.com', -1000),
    confirmed: seed('done@example.com'),
    delivered: seed('mailed@example.com'),
  };
  confirmSubscriber(stranded.confirmed);
  markNewsletterEmailSent(stranded.delivered);

  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    htmlShell: './src/shell.html',
    email: {
      from: 'Mochi <noreply@mochi.fast>',
      transport: {
        type: 'custom',
        send: (message) => {
          sent.push(message);
        },
      },
    },
    queues: { [NEWSLETTER_EMAIL_QUEUE]: newsletterEmailQueue },
    routes: {},
  });
});

afterAll(async () => {
  server?.stop(true);
  closeDb();
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(outDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

const recipients = (): string[] => sent.flatMap((m) => m.to);

test('a signup whose confirmation was never sent is re-enqueued on boot', async () => {
  await waitFor(() => getSubscriber(stranded.pending)?.email_status === 'sent');
  expect(getSubscriber(stranded.pending)?.email_status).toBe('sent');
  expect(recipients()).toContain('waiting@example.com');
  expect((newsletterLogsBySubscriber()[stranded.pending] ?? [])[0]?.event).toBe('requeued');
});

test('an expired signup is left alone', () => {
  // Unlike a support ticket, a confirmation link the recipient can no longer use
  // is only spam — expiry takes it out of the recovery set for good.
  expect(pendingConfirmationIds()).not.toContain(stranded.expired);
  expect(recipients()).not.toContain('stale@example.com');
});

test('an already-confirmed signup is not mailed again', () => {
  expect(recipients()).not.toContain('done@example.com');
});

test('a signup whose confirmation already went out is not mailed again', () => {
  expect(recipients()).not.toContain('mailed@example.com');
  expect(newsletterLogsBySubscriber()[stranded.delivered] ?? []).toEqual([]);
});
