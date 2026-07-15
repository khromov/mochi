import { Mochi, fail, success, logger, mintCaptcha, verifyCaptcha, consumeCaptcha } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

const SUPPORT_TO = process.env.SUPPORT_TO || 'support@mochi.fast';

export const routes: Record<string, MochiRouteValue> = {
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
        // email typo shouldn't burn it) but before sending (a retried SMTP
        // failure must not double-send).
        if (!(await consumeCaptcha(captcha))) {
          return fail(400, { error: 'This form was already submitted. Reload the page to send another message.' });
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
