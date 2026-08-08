import { Mochi, fail, redirect, success, logger, mintCaptcha, verifyCaptcha, consumeCaptcha, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { authFailureDelay, credentialsMatch } from './adminAuth';
import { appendEmailLog, emailLogsBySubmission, insertSubmission, listSubmissions, setHandled } from './db.server';
import { SUPPORT_EMAIL_QUEUE, SUPPORT_TO } from './jobs.server';
import type { SupportEmailJob } from './jobs.server';

export const routes: Record<string, MochiRouteValue> = {
  '/': Mochi.page('./src/Support.svelte', {
    serverProps: () => ({ captcha: mintCaptcha() }),
    actions: {
      send: async ({ formData }) => {
        // The client re-derives the hash chain and solves a SHA-256 proof-of-work so a passing POST proves real work was spent; nonce burn is deferred to `consumeCaptcha()` below so validation can still reject first.
        const captcha = await verifyCaptcha(formData, { consume: false });
        if (!captcha.ok) {
          return fail(400, { error: captcha.error });
        }
        // Collapse whitespace so visitor input can't smuggle CR/LF into the subject or Reply-To headers.
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
        // Consume the one-time nonce after validation (a fixable typo shouldn't burn it) but before storing (a retried submit must not duplicate the row).
        if (!(await consumeCaptcha(captcha))) {
          return fail(400, { error: 'This form was already submitted. Reload the page to send another message.' });
        }
        // Store first, deliver later: once committed the message can't be lost to an SMTP outage, so the visitor is told it landed and failures surface in /admin/ instead.
        let id: number;
        try {
          id = insertSubmission({ name, email, message });
        } catch (err) {
          logger.error('support: could not store submission', err);
          return fail(500, { error: 'We could not receive your message right now. Please email support@mochi.fast directly.' });
        }
        // Logged before enqueuing so the entry can't be ordered after the worker's own `sending` line.
        appendEmailLog(id, { attempt: 0, event: 'queued', detail: `Queued for delivery to ${SUPPORT_TO}` });
        try {
          await Mochi.getQueue<SupportEmailJob>(SUPPORT_EMAIL_QUEUE).add({ id });
        } catch (err) {
          // The row stays `pending` and visible in the admin panel for manual follow-up — telling the visitor it failed would be wrong.
          logger.error('support: could not enqueue delivery', err);
        }
        return success();
      },
    },
  }),
  '/admin': Mochi.page('./src/admin/Admin.svelte', {
    // The limiter runs before adminAuth so it can't see the auth result — re-check credentials here and skip quota unless this is a genuine wrong guess.
    rateLimit: {
      limit: 10,
      window: '15m',
      ban: { threshold: 3, duration: '1h' },
      // The limiter's skip runs ahead of everything else on this route, so it's the one place that can slow a wrong guess without touching a successful admin request.
      skip: async (req) => {
        const header = req.headers.get('Authorization');
        // A request with no credentials is just the browser fetching the 401 challenge, not a guess — only an actual wrong guess waits or spends quota.
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
        // Shown in the footer so the proxy's client-IP resolution — what the rate limiter keys on — can be verified in production.
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
    },
  }),
  '/health': Mochi.api(() => Response.json({ status: 'ok' })),
};
