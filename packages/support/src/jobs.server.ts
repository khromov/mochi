import { Mochi, defineJobTypes, logger } from 'mochi-framework';
import { appendEmailLog, getSubmission, markEmailFailed, markEmailSent, noteEmailAttemptError, supportDb } from './db.server';

export const SUPPORT_TO = process.env.SUPPORT_TO || 'support@mochi.fast';

// Shared by the retry backoff and the processor, which needs to know whether the attempt it is failing is the last one
// worth making before marking the row terminally `failed`.
const MAX_ATTEMPTS = 3;

// Overridable so the test suite can drive the full three-attempt path without real backoff waits.
const RETRY_DELAY_MS = Number(process.env.SUPPORT_RETRY_DELAY_MS) || 5_000;

// The jobs runtime shares the submissions database, so a submission row and its delivery job commit in ONE SQLite
// transaction (see routes.ts) and pending deliveries survive restarts inside the same file — no boot-time re-enqueue
// pass needed. The write helpers below run either inside `complete()` (joining the job's own transaction) or wrapped in
// `supportJobs.withTransaction` — never bare, which on a shared connection could interleave into an open job transaction.
export const supportJobs = Mochi.jobs({
  backend: { kind: 'sqlite', database: supportDb() },
  concurrency: 2,
  retry: { initialDelayMs: RETRY_DELAY_MS, maxDelayMs: 300_000, multiplier: 2 },
  types: defineJobTypes<{
    'send-support-email': { entry: true; input: { id: number }; output: { sent: boolean } };
  }>(),
  processors: {
    'send-support-email': {
      attemptHandler: async ({ job, complete }) => {
        const submission = getSubmission(job.input.id);
        if (!submission) {
          logger.warn(`support: submission ${job.input.id} vanished before its email was sent`);
          return complete(async () => ({ sent: false }));
        }
        const { id, name, email, message } = submission;
        await supportJobs.withTransaction(async () => appendEmailLog(id, { attempt: job.attempt, event: 'sending', detail: `Delivering to ${SUPPORT_TO}` }));
        let result;
        try {
          result = await Mochi.email({
            to: SUPPORT_TO,
            replyTo: email,
            subject: `Support request from ${name || email}`,
            component: './src/emails/SupportEmail.svelte',
            props: { name, email, message },
            text: [`From: ${name || '(no name)'} <${email}>`, '', message].join('\n'),
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (job.attempt >= MAX_ATTEMPTS) {
            // Terminal: completing (rather than throwing) stops the retry loop, and the `failed` row + log line commit
            // atomically with the job's completion.
            return complete(async () => {
              markEmailFailed(id, reason);
              appendEmailLog(id, { attempt: job.attempt, event: 'failed', detail: reason });
              return { sent: false };
            });
          }
          // Recorded before rethrowing so the admin panel shows why while the retry backs off; the row stays `pending`
          // because the durable job will try again.
          await supportJobs.withTransaction(async () => {
            noteEmailAttemptError(id, reason);
            appendEmailLog(id, { attempt: job.attempt, event: 'failed', detail: reason });
          });
          throw err;
        }
        return complete(async () => {
          markEmailSent(id);
          appendEmailLog(id, {
            attempt: job.attempt,
            event: 'sent',
            detail: [
              `transport: ${result.transport}`,
              result.messageId ? `id: ${result.messageId}` : null,
              result.accepted?.length ? `accepted: ${result.accepted.join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          });
          return { sent: true };
        });
      },
    },
  },
});
