import { Mochi, logger } from 'mochi-framework';
import { appendEmailLog, getSubmission, markEmailFailed, markEmailSent, noteEmailAttemptError } from './db.server';

export const SUPPORT_TO = process.env.SUPPORT_TO || 'support@mochi.fast';

export const SUPPORT_EMAIL_QUEUE = 'support-emails';

// Shared by retryLimit and the processor, which needs to know whether the attempt it is failing is the last one.
const MAX_ATTEMPTS = 3;

export interface SupportEmailJob {
  id: number;
}

// Jobs live in the durable queue store (`queueStorage: { sqlite }` in index.ts), so an email queued before a crash or
// restart is retried from there — the submissions table only tracks delivery status for the admin panel.
export const supportEmailQueue = Mochi.queue<SupportEmailJob>(SUPPORT_EMAIL_QUEUE, {
  concurrency: 2,
  retryLimit: MAX_ATTEMPTS - 1,
  retryDelay: 5,
  retryBackoff: true,
  process: async (job) => {
    const submission = getSubmission(job.data.id);
    if (!submission) {
      logger.warn(`support: submission ${job.data.id} vanished before its email was sent`);
      return { sent: false };
    }
    const { name, email, message } = submission;
    appendEmailLog(submission.id, { attempt: job.attempt, event: 'sending', detail: `Delivering to ${SUPPORT_TO}` });
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
      // Recorded before rethrowing so the admin panel shows why while the queue retries — only the last attempt marks the row `failed`; a restart mid-backoff keeps the retry in the durable queue store.
      const reason = err instanceof Error ? err.message : String(err);
      if (job.attempt >= MAX_ATTEMPTS) {
        markEmailFailed(submission.id, reason);
      } else {
        noteEmailAttemptError(submission.id, reason);
      }
      appendEmailLog(submission.id, { attempt: job.attempt, event: 'failed', detail: reason });
      throw err;
    }
    markEmailSent(submission.id);
    appendEmailLog(submission.id, {
      attempt: job.attempt,
      event: 'sent',
      detail: [`transport: ${result.transport}`, result.messageId ? `id: ${result.messageId}` : null, result.accepted?.length ? `accepted: ${result.accepted.join(', ')}` : null]
        .filter(Boolean)
        .join(' · '),
    });
    return { sent: true };
  },
});
