import { Mochi, fail, success, logger, mintCaptcha, verifyCaptcha, consumeCaptcha, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { appendNewsletterLog, confirmSubscriber, requestSubscription, subscriberByConfirmToken, subscriberByUnsubscribeToken, unsubscribeSubscriber } from '../db.server';
import { embedAncestors } from '../embedHeaders';
import { CONFIRM_TTL_MS, RESEND_COOLDOWN_MS } from './config';
import { newsletterEmailQueue } from './jobs.server';

export type TokenPageState = 'confirmed' | 'already' | 'expired' | 'unknown' | 'unsubscribed';

export const newsletterRoutes: Record<string, MochiRouteValue> = {
  '/newsletter/embed': Mochi.page('./src/newsletter/NewsletterEmbed.svelte', {
    // GETs are excluded: the widget loads on the blog index and every post, so
    // counting page views bans an ordinary reader — and a whole NAT with them.
    // Only the signup POST spends quota, mirroring /admin's `skip` below.
    rateLimit: {
      limit: 20,
      window: '10m',
      ban: { threshold: 3, duration: '1h' },
      skip: (req) => req.method !== 'POST',
    },
    serverProps: () => {
      const { url } = getRequestContext();
      return {
        captcha: mintCaptcha(),
        source: url.searchParams.get('src')?.slice(0, 200) ?? '',
        origins: embedAncestors(),
      };
    },
    actions: {
      subscribe: async ({ formData }) => {
        // Honeypot, answered like a real signup so a bot learns nothing.
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
        // After field validation so a typo doesn't cost the nonce, before the
        // write so a double submit can't re-arm the same row twice.
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
            await newsletterEmailQueue.add({ id: outcome.id });
          } catch (err) {
            // The row stays `pending` and visible on the admin panel's newsletter tab, where Resend re-enqueues it.
            logger.error('newsletter: could not enqueue confirmation', err);
          }
        }
        // Identical for every outcome — see requestSubscription.
        return success();
      },
    },
  }),

  // GET on purpose: the token is the authorisation, and one-click
  // List-Unsubscribe requires unsubscribe to be safe to hit unauthenticated. The
  // cost is that a link-prefetching mail scanner confirms on the recipient's behalf.
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
