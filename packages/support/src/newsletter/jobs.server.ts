import { Mochi, logger } from 'mochi-framework';
import type { MochiQueueConfig } from 'mochi-framework';
import {
  appendNewsletterLog,
  getSubscriber,
  markNewsletterEmailFailed,
  markNewsletterEmailRequeued,
  markNewsletterEmailSent,
  noteNewsletterAttemptError,
  pendingConfirmationIds,
} from '../db.server';
import { confirmUrl, unsubscribeUrl } from './config';

export const NEWSLETTER_EMAIL_QUEUE = 'newsletter-emails';

const MAX_ATTEMPTS = 3;

export interface NewsletterEmailJob {
  id: number;
}

// No `dataPath` — bunqueue locks its embedded store to the first one in the
// process, so this queue would silently share the support queue's.
export const newsletterEmailQueue: MochiQueueConfig = Mochi.queue<NewsletterEmailJob>({
  concurrency: 2,
  defaultJobOptions: { attempts: MAX_ATTEMPTS },
  bunqueue: { backoff: { type: 'exponential', delay: 5000 } },
  recover: async (queue) => {
    const stranded = pendingConfirmationIds();
    if (stranded.length === 0) {
      return;
    }
    for (const id of stranded) {
      markNewsletterEmailRequeued(id);
      appendNewsletterLog(id, { attempt: 0, event: 'requeued', detail: 'Re-queued on server start' });
    }
    await queue.addBulk(stranded.map((id) => ({ name: 'confirm', data: { id } })));
  },
  process: async (job) => {
    const subscriber = getSubscriber(job.data.id);
    if (!subscriber) {
      logger.warn(`newsletter: subscriber ${job.data.id} vanished before its confirmation was sent`);
      return { sent: false };
    }
    if (subscriber.status !== 'pending') {
      appendNewsletterLog(subscriber.id, { attempt: job.attempt, event: 'sent', detail: `Skipped — already ${subscriber.status}` });
      return { sent: false };
    }
    appendNewsletterLog(subscriber.id, { attempt: job.attempt, event: 'sending', detail: `Confirmation to ${subscriber.email}` });
    const confirm = confirmUrl(subscriber.confirm_token);
    const unsubscribe = unsubscribeUrl(subscriber.unsubscribe_token);
    let result;
    try {
      result = await Mochi.email({
        to: subscriber.email,
        from: process.env.NEWSLETTER_FROM || undefined,
        subject: 'Confirm your Mochi newsletter subscription',
        component: './src/emails/NewsletterConfirmEmail.svelte',
        props: { confirmUrl: confirm, unsubscribeUrl: unsubscribe },
        text: [
          'Confirm your Mochi newsletter subscription by opening this link:',
          '',
          confirm,
          '',
          "Didn't sign up? Ignore this email — nothing happens until you confirm.",
          '',
          `Unsubscribe: ${unsubscribe}`,
        ].join('\n'),
        headers: {
          'List-Unsubscribe': `<${unsubscribe}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (job.attempt >= MAX_ATTEMPTS) {
        markNewsletterEmailFailed(subscriber.id, reason);
      } else {
        noteNewsletterAttemptError(subscriber.id, reason);
      }
      appendNewsletterLog(subscriber.id, { attempt: job.attempt, event: 'failed', detail: reason });
      throw err;
    }
    markNewsletterEmailSent(subscriber.id);
    appendNewsletterLog(subscriber.id, {
      attempt: job.attempt,
      event: 'sent',
      detail: [`transport: ${result.transport}`, result.messageId ? `id: ${result.messageId}` : null].filter(Boolean).join(' · '),
    });
    return { sent: true };
  },
});
