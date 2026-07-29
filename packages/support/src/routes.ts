import { Mochi, fail, redirect, success, logger, mintCaptcha, verifyCaptcha, consumeCaptcha, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { authFailureDelay, credentialsMatch } from './adminAuth';
import {
  appendEmailLog,
  appendNewsletterLog,
  deleteSubscriber,
  emailLogsBySubmission,
  insertSubmission,
  listSubmissions,
  listSubscribers,
  newsletterLogsBySubscriber,
  refreshConfirmToken,
  setHandled,
  unsubscribeSubscriber,
} from './db.server';
import { SUPPORT_EMAIL_QUEUE, SUPPORT_TO } from './jobs.server';
import type { SupportEmailJob } from './jobs.server';
import { CONFIRM_TTL_MS } from './newsletter/config';
import { NEWSLETTER_EMAIL_QUEUE } from './newsletter/jobs.server';
import type { NewsletterEmailJob } from './newsletter/jobs.server';
import { newsletterRoutes } from './newsletter/routes';

export const routes: Record<string, MochiRouteValue> = {
  ...newsletterRoutes,
  '/': Mochi.page('./src/Support.svelte', {
    serverProps: () => ({ captcha: mintCaptcha() }),
    actions: {
      send: async ({ formData }) => {
        // The token is minted at SSR; the client must re-derive the slide-step
        // hash chain and solve a SHA-256 proof-of-work over its final link, so
        // a passing POST proves the page was fetched, the captcha logic ran,
        // and real hashing work was spent. Burning the nonce is deferred to
        // consumeCaptcha() below so field validation can still reject first.
        const captcha = await verifyCaptcha(formData, { consume: false });
        if (!captcha.ok) {
          return fail(400, { error: captcha.error });
        }
        // Collapse whitespace so visitor input can't smuggle CR/LF into the
        // subject or Reply-To headers.
        const name = String(formData.get('name') ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200);
        const email = String(formData.get('email') ?? '').trim();
        const message = String(formData.get('message') ?? '')
          .trim()
          .slice(0, 5000);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return fail(400, { error: 'Enter a valid email address so we can reply.' });
        }
        if (!message) {
          return fail(400, { error: 'Tell us what you need help with.' });
        }
        // Consume the one-time nonce only after field validation (a fixable
        // email typo shouldn't burn it) but before storing (a retried submit
        // must not duplicate the row).
        if (!(await consumeCaptcha(captcha))) {
          return fail(400, { error: 'This form was already submitted. Reload the page to send another message.' });
        }
        // Store first, deliver later: once the row is committed the message
        // can't be lost to an SMTP outage, so the visitor is told it landed
        // and delivery failures surface in /admin/ instead of on the form.
        // Committing the row is therefore the only step that can fail the
        // submission.
        let id: number;
        try {
          id = insertSubmission({ name, email, message });
        } catch (err) {
          logger.error('support: could not store submission', err);
          return fail(500, { error: 'We could not receive your message right now. Please email support@mochi.fast directly.' });
        }
        // Logged before enqueuing so the entry can't be ordered after the
        // worker's own `sending` line.
        appendEmailLog(id, { attempt: 0, event: 'queued', detail: `Queued for delivery to ${SUPPORT_TO}` });
        try {
          await Mochi.getQueue<SupportEmailJob>(SUPPORT_EMAIL_QUEUE).add('send', { id });
        } catch (err) {
          // The row is committed and still `pending`, so recover() picks it up
          // on the next boot. Telling the visitor it failed would be wrong.
          logger.error('support: could not enqueue delivery', err);
        }
        return success();
      },
    },
  }),
  '/admin': Mochi.page('./src/admin/Admin.svelte', {
    // The limiter runs before the adminAuth middleware, so it can't see the auth
    // result — re-check the credentials here and skip (spending no quota) unless
    // this is a wrong guess. Only guesses count, which is the brute-force we want
    // to stop, and knowing the password always gets you in even mid-ban.
    rateLimit: {
      limit: 10,
      window: '15m',
      ban: { threshold: 3, duration: '1h' },
      // Wrong credentials also pay a fixed delay here — the limiter's skip runs
      // ahead of everything else on this route, so it's the one place that
      // slows the 401 (and the 429 once the quota is gone) without touching a
      // successful admin request.
      skip: async (req) => {
        const header = req.headers.get('Authorization');
        // A request with no credentials is just a browser fetching the 401
        // challenge on its way to the login prompt — it guesses nothing, so it
        // neither waits nor spends quota. Only an actual wrong guess does both.
        if (!header || credentialsMatch(header)) {
          return true;
        }
        await authFailureDelay();
        return false;
      },
    },
    serverProps: () => {
      const ctx = getRequestContext();
      return {
        inbox: listSubmissions(false),
        handled: listSubmissions(true),
        logs: emailLogsBySubmission(),
        subscribers: listSubscribers(),
        newsletterLogs: newsletterLogsBySubscriber(),
        // Shown in the footer so the proxy's client-IP resolution — what the
        // rate limiter keys on — can be verified in production.
        client: { address: ctx.getClientAddress(), forwardedFor: ctx.request.headers.get('x-forwarded-for') },
      };
    },
    // Post/Redirect/Get so a refresh after triaging doesn't re-submit.
    actions: {
      handle: ({ formData }) => {
        setHandled(Number(formData.get('id')), true);
        return redirect(303, '/admin/');
      },
      unhandle: ({ formData }) => {
        setHandled(Number(formData.get('id')), false);
        return redirect(303, '/admin/');
      },
      // Mints a fresh token, so the link in the previous email stops working —
      // there is only ever one live confirmation link per address.
      resendConfirmation: async ({ formData }) => {
        const id = Number(formData.get('id'));
        refreshConfirmToken(id, CONFIRM_TTL_MS);
        appendNewsletterLog(id, { attempt: 0, event: 'queued', detail: 'Re-sent from the admin panel' });
        try {
          await Mochi.getQueue<NewsletterEmailJob>(NEWSLETTER_EMAIL_QUEUE).add('confirm', { id });
        } catch (err) {
          logger.error('newsletter: could not enqueue confirmation resend', err);
        }
        return redirect(303, '/admin/');
      },
      unsubscribeSignup: ({ formData }) => {
        unsubscribeSubscriber(Number(formData.get('id')));
        return redirect(303, '/admin/');
      },
      deleteSignup: ({ formData }) => {
        deleteSubscriber(Number(formData.get('id')));
        return redirect(303, '/admin/');
      },
    },
  }),
  '/health': Mochi.api(() => Response.json({ status: 'ok' })),
};
