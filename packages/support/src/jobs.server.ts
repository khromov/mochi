import { Mochi, logger } from 'mochi-framework';
import type { MochiQueueConfig } from 'mochi-framework';
import { appendEmailLog, getSubmission, markEmailFailed, markEmailRequeued, markEmailSent, noteEmailAttemptError, undeliveredSubmissionIds } from './db.server';

export const SUPPORT_TO = process.env.SUPPORT_TO || 'support@mochi.fast';

export const SUPPORT_EMAIL_QUEUE = 'support-emails';

// Shared by defaultJobOptions and the processor, which needs to know whether the
// attempt it is failing is the last one bunqueue will make.
const MAX_ATTEMPTS = 3;

export interface SupportEmailJob {
  id: number;
}

// In-memory: jobs don't survive a restart. The submission itself is already
// committed to SQLite, so `recover` puts every row that hasn't been delivered
// back on the queue at boot — the rows, not the queue, are the source of truth.
export const supportEmailQueue: MochiQueueConfig = Mochi.queue<SupportEmailJob>({
  concurrency: 2,
  defaultJobOptions: { attempts: MAX_ATTEMPTS },
  bunqueue: { backoff: { type: 'exponential', delay: 5000 } },
  recover: async (queue) => {
    const stranded = undeliveredSubmissionIds();
    if (stranded.length === 0) {
      return;
    }
    // Status and log first: once addBulk resolves the worker may already be
    // processing, and a row it marks `sent` must not then be reset to `pending`.
    for (const id of stranded) {
      markEmailRequeued(id);
      appendEmailLog(id, { attempt: 0, event: 'requeued', detail: 'Re-queued on server start' });
    }
    await queue.addBulk(stranded.map((id) => ({ name: 'send', data: { id } })));
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
        component: './src/SupportEmail.svelte',
        props: { name, email, message },
        text: [`From: ${name || '(no name)'} <${email}>`, '', message].join('\n'),
      });
    } catch (err) {
      // Recorded before rethrowing so the admin panel shows why, even while
      // bunqueue is still retrying. Only the last attempt is terminal: until
      // then the row stays `pending`, so a restart mid-backoff leaves it in the
      // set `recover` re-enqueues rather than stranding it as `failed`.
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
