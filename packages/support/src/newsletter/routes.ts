import { Mochi, fail, success, logger, mintCaptcha, verifyCaptcha, consumeCaptcha, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { appendNewsletterLog, confirmSubscriber, requestSubscription, subscriberByConfirmToken, subscriberByUnsubscribeToken, unsubscribeSubscriber } from '../db.server';
import { CONFIRM_TTL_MS, RESEND_COOLDOWN_MS } from './config';
import { NEWSLETTER_EMAIL_QUEUE } from './jobs.server';
import type { NewsletterEmailJob } from './jobs.server';

/** What the confirm / unsubscribe pages render. `unknown` covers a bad or already-rotated token. */
export type TokenPageState = 'confirmed' | 'already' | 'expired' | 'unknown' | 'unsubscribed';

export const newsletterRoutes: Record<string, MochiRouteValue> = {
  '/newsletter/embed': Mochi.page('./src/newsletter/NewsletterEmbed.svelte', {
    rateLimit: { limit: 20, window: '10m', ban: { threshold: 3, duration: '1h' } },
    serverProps: () => {
      const { url } = getRequestContext();
      return {
        captcha: mintCaptcha(),
        // The host page passes ?src=<blog slug> so the admin panel can see which
        // post drove a signup.
        source: url.searchParams.get('src')?.slice(0, 200) ?? '',
      };
    },
    actions: {
      subscribe: async ({ formData }) => {
        // Honeypot first: the cheapest check, and a bot never gets to spend our
        // captcha verification budget. Answered with the same success payload a
        // real signup gets, so a bot learns nothing from being filtered.
        if (String(formData.get('website') ?? '').trim() !== '') {
          return success();
        }
        const captcha = await verifyCaptcha(formData, { consume: false });
        if (!captcha.ok) {
          return fail(400, { error: captcha.error });
        }
        const email = String(formData.get('email') ?? '')
          .trim()
          .slice(0, 320);
        const source = String(formData.get('source') ?? '')
          .trim()
          .slice(0, 200);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return fail(400, { error: 'Enter a valid email address.' });
        }
        // Burned after field validation (a typo shouldn't cost the nonce) but
        // before the write, so a double submit can't re-arm the same row twice.
        if (!(await consumeCaptcha(captcha))) {
          return fail(400, { error: 'This form was already submitted. Reload to subscribe another address.' });
        }
        let outcome;
        try {
          outcome = requestSubscription({ email, source }, { cooldownMs: RESEND_COOLDOWN_MS, ttlMs: CONFIRM_TTL_MS });
        } catch (err) {
          logger.error('newsletter: could not store subscription', err);
          return fail(500, { error: 'We could not sign you up right now. Please try again later.' });
        }
        if (outcome.kind !== 'throttled' && outcome.kind !== 'already') {
          appendNewsletterLog(outcome.id, { attempt: 0, event: 'queued', detail: `Confirmation to ${email}` });
          try {
            await Mochi.getQueue<NewsletterEmailJob>(NEWSLETTER_EMAIL_QUEUE).add('confirm', { id: outcome.id });
          } catch (err) {
            // The row is stored and still pending, so recover() picks it up on
            // the next boot. Telling the visitor it failed would be wrong.
            logger.error('newsletter: could not enqueue confirmation', err);
          }
        }
        // Every outcome answers identically. The widget is public, so a reply that
        // distinguished "new" from "already subscribed" would make it an oracle
        // for whether an address is on the list.
        return success();
      },
    },
  }),

  // GET, and unauthenticated: the token is the authorisation, and CSRF only gates
  // state-changing verbs. Known cost of one-click double opt-in — a corporate link
  // scanner that prefetches the email will confirm on the recipient's behalf.
  // One-click List-Unsubscribe likewise requires unsubscribe to be a plain GET.
  '/newsletter/confirm': Mochi.page('./src/newsletter/NewsletterConfirm.svelte', {
    rateLimit: { limit: 30, window: '10m' },
    serverProps: () => {
      const { url } = getRequestContext();
      const subscriber = subscriberByConfirmToken(url.searchParams.get('token') ?? '');
      if (!subscriber) {
        return { state: 'unknown' satisfies TokenPageState };
      }
      if (subscriber.status === 'confirmed') {
        return { state: 'already' satisfies TokenPageState };
      }
      if (subscriber.status === 'unsubscribed') {
        return { state: 'unsubscribed' satisfies TokenPageState };
      }
      if (subscriber.confirm_expires_at <= Date.now()) {
        return { state: 'expired' satisfies TokenPageState };
      }
      confirmSubscriber(subscriber.id);
      return { state: 'confirmed' satisfies TokenPageState };
    },
  }),

  '/newsletter/unsubscribe': Mochi.page('./src/newsletter/NewsletterUnsubscribe.svelte', {
    rateLimit: { limit: 30, window: '10m' },
    serverProps: () => {
      const { url } = getRequestContext();
      const subscriber = subscriberByUnsubscribeToken(url.searchParams.get('token') ?? '');
      if (!subscriber) {
        return { state: 'unknown' satisfies TokenPageState };
      }
      if (subscriber.status !== 'unsubscribed') {
        unsubscribeSubscriber(subscriber.id);
      }
      return { state: 'unsubscribed' satisfies TokenPageState };
    },
  }),
};
