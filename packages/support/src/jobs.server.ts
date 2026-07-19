import { Mochi, logger } from 'mochi-framework';
import type { MochiQueueConfig } from 'mochi-framework';
import { getSubmission, markEmailFailed, markEmailSent } from './db.server';

const SUPPORT_TO = process.env.SUPPORT_TO || 'support@mochi.fast';

export const SUPPORT_EMAIL_QUEUE = 'support-emails';

export interface SupportEmailJob {
  id: number;
}

// In-memory: jobs don't survive a restart. The submission itself is already
// committed to SQLite, and index.ts re-enqueues anything left `pending` on boot.
export const supportEmailQueue: MochiQueueConfig = Mochi.queue<SupportEmailJob>({
  concurrency: 2,
  defaultJobOptions: { attempts: 3 },
  bunqueue: { backoff: { type: 'exponential', delay: 5000 } },
  process: async (job) => {
    const submission = getSubmission(job.data.id);
    if (!submission) {
      logger.warn(`support: submission ${job.data.id} vanished before its email was sent`);
      return { sent: false };
    }
    const { name, email, message } = submission;
    try {
      await Mochi.email({
        to: SUPPORT_TO,
        replyTo: email,
        subject: `Support request from ${name || email}`,
        component: './src/SupportEmail.svelte',
        props: { name, email, message },
        text: [`From: ${name || '(no name)'} <${email}>`, '', message].join('\n'),
      });
    } catch (err) {
      // Recorded before rethrowing so the admin panel shows why, even while
      // bunqueue is still retrying.
      markEmailFailed(submission.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
    markEmailSent(submission.id);
    return { sent: true };
  },
});
