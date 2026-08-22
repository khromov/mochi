import { Mochi, logger } from 'mochi-framework';
import {
  appendNewsletterLog,
  claimNewsletterSend,
  getSubscriber,
  markNewsletterEmailFailed,
  markNewsletterEmailSent,
  noteNewsletterAttemptError,
  purgeExpiredPendingSubscribers,
} from '../db.server';
import { confirmUrl, unsubscribeUrl } from './config';

export const NEWSLETTER_EMAIL_QUEUE = 'newsletter-emails';

// Shared by retryLimit and the processor, which needs to know whether the attempt it is failing is the last one.
const MAX_ATTEMPTS = 3;

export interface NewsletterEmailJob {
  id: number;
}

// Shares the durable queue store the support queue uses (`queueStorage: { sqlite }` in index.ts), so a confirmation
// queued before a restart is still delivered from there — the subscriber row only tracks status for the admin panel.
export const newsletterEmailQueue = Mochi.queue<NewsletterEmailJob>(NEWSLETTER_EMAIL_QUEUE, {
  concurrency: 2,
  retryLimit: MAX_ATTEMPTS - 1,
  retryDelay: 5,
  retryBackoff: true,
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
    // A resend racing the original (or the queue delivering the same job twice) would otherwise mail two confirmations;
    // the claim lets exactly one job through until a failure re-arms the row or the admin resend does.
    if (!claimNewsletterSend(subscriber.id)) {
      appendNewsletterLog(subscriber.id, { attempt: job.attempt, event: 'sent', detail: 'Skipped — another job already handled this confirmation' });
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
        // Only the RFC 2369 URL form, which the unsubscribe page handles as a GET. RFC 8058 one-click needs a
        // List-Unsubscribe-Post header, but that makes the provider POST to the bare URL — a 405 here (the page has no
        // actions) and a CSRF reject anyway — so advertising it would fail the one-click it promises. Add it back with
        // a real CSRF-exempt POST endpoint when broadcast ships and one-click actually matters.
        headers: {
          'List-Unsubscribe': `<${unsubscribe}>`,
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

/**
 * A pending sign-up whose confirmation window closed is otherwise only noticed when someone visits the dead token, so
 * unconfirmed addresses accumulate forever. Nightly at 03:15, offset off the hour to avoid the thundering herd.
 */
export const purgeExpiredSubscribers = Mochi.cron('newsletter-purge-expired', '15 3 * * *', () => {
  const removed = purgeExpiredPendingSubscribers();
  if (removed > 0) {
    logger.info(`[newsletter] purged ${removed} expired pending sign-up(s)`);
  }
});
