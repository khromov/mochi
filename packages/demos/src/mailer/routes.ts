import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { renderRawEmailHtml } from './templates/rawHtml';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATES = ['text', 'html', 'svelte'] as const;
type Template = (typeof TEMPLATES)[number];

export const routes: Record<string, MochiRouteValue> = {
  '/mailer': Mochi.page('./src/mailer/MailerPage.svelte', {
    actions: {
      send: async ({ formData }) => {
        const to = String(formData.get('to') ?? '').trim();
        const subject = String(formData.get('subject') ?? '').trim();
        const message = String(formData.get('message') ?? '').trim();
        const templateRaw = String(formData.get('template') ?? 'text');
        const template = (TEMPLATES as readonly string[]).includes(templateRaw) ? (templateRaw as Template) : 'text';

        if (!to || !EMAIL_RE.test(to)) {
          return fail(400, { error: 'Enter a valid recipient email address.' });
        }
        if (!subject) {
          return fail(400, { error: 'Enter a subject.' });
        }
        if (!message) {
          return fail(400, { error: 'Enter a message.' });
        }

        try {
          if (template === 'html') {
            await Mochi.email({ to, subject, html: renderRawEmailHtml({ subject, message }) });
          } else if (template === 'svelte') {
            await Mochi.email({
              to,
              subject,
              component: './src/mailer/templates/EmailTemplate.svelte',
              props: { subject, message },
            });
          } else {
            await Mochi.email({ to, subject, text: message });
          }
        } catch (err) {
          return fail(502, { error: err instanceof Error ? err.message : 'Failed to send email.' });
        }

        return success({ to, subject, template });
      },
    },
  }),
};
