import { Mochi, logger } from 'mochi-framework';
import type { MochiQueueConfig } from 'mochi-framework';
import { appendEmailLog, getSubmission, markEmailFailed, markEmailRequeued, markEmailSent, noteEmailAttemptError, undeliveredSubmissionIds } from './db.server';

export const SUPPORT_TO = process.env.SUPPORT_TO || 'support@mochi.fast';

export const SUPPORT_EMAIL_QUEUE = 'support-emails';

// Shared by maxRetries (better-queue's total attempt budget) and the processor,
// which needs to know whether the attempt it is failing is the last one.
const MAX_ATTEMPTS = 3;

export interface SupportEmailJob {
  id: number;
}

// In-memory: jobs don't survive a restart, so `recover` puts every undelivered row (the source of truth, since it's committed to SQLite) back on the queue at boot.
// TODO: this assumes a single instance — scaling out would double-send until mochi's queue.ts gets single-flight support.
export const supportEmailQueue: MochiQueueConfig = Mochi.queue<SupportEmailJob>({
  concurrent: 2,
  maxRetries: MAX_ATTEMPTS,
  retryDelay: 5000,
  recover: async (queue) => {
    const stranded = undeliveredSubmissionIds();
    if (stranded.length === 0) {
      return;
    }
    // Status and log first: once the pushes resolve the queue may already be
    // processing, and a row it marks `sent` must not then be reset to `pending`.
    for (const id of stranded) {
      markEmailRequeued(id);
      appendEmailLog(id, { attempt: 0, event: 'requeued', detail: 'Re-queued on server start' });
    }
    await Promise.all(stranded.map((id) => queue.push({ id })));
  },
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
      // Recorded before rethrowing so the admin panel shows why while the queue retries — only the last attempt is terminal, so a restart mid-retry leaves the row for `recover` instead of stranding it as `failed`.
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
