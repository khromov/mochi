import { Mochi, fail, success, logger } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

const SUPPORT_TO = process.env.SUPPORT_TO || 'support@mochi.fast';

export const routes: Record<string, MochiRouteValue> = {
  '/': Mochi.page('./src/Support.svelte', {
    actions: {
      send: async ({ formData }) => {
        // The hidden field is only filled once the slider reaches the end —
        // a cheap gate against non-JS form bots, not real abuse protection.
        if (String(formData.get('captcha') ?? '') !== 'slid') {
          return fail(400, { error: 'Please slide the mochi to confirm you are human.' });
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
          // A real SMTP transport can fail where the `log` transport never could.
          // Without this the visitor gets a 500 page and loses what they typed.
          logger.error('support: send failed', err);
          return fail(500, { error: 'We could not send your message right now. Please email support@mochi.fast directly.' });
        }
        return success();
      },
    },
  }),
  '/health': Mochi.api(() => Response.json({ status: 'ok' })),
};
