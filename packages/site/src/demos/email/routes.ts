import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { ATTACHMENT, DEMO_TO, presetById } from './presets';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/email': Mochi.page('./src/demos/email/Email.svelte', {
    actions: {
      // The form only submits a `preset` id; validating it against the allowlist
      // means no visitor-supplied recipient/subject/body can ever reach the mailer.
      send: async ({ formData }) => {
        const preset = presetById(String(formData.get('preset') ?? ''));
        if (!preset) {
          return fail(400, { error: 'Pick one of the pre-written emails.' });
        }
        await Mochi.email({
          from: 'Mochi Demo <noreply@mochi.demo>',
          to: DEMO_TO,
          subject: preset.subject,
          component: './src/demos/email/PresetEmail.svelte',
          props: { preset: preset.id, name: 'Ada' },
        });
        return success({ preset: preset.id, subject: preset.subject });
      },
      // Read the (pre-resized) image off disk and hand it to Mochi.email() as a
      // real file attachment. The recipient, subject, and file are all fixed
      // server-side — nothing about the attachment comes from the request.
      sendPhoto: async () => {
        const content = await Bun.file(ATTACHMENT.path).bytes();
        await Mochi.email({
          from: 'Mochi Demo <noreply@mochi.demo>',
          to: DEMO_TO,
          subject: ATTACHMENT.subject,
          component: './src/demos/email/AttachmentEmail.svelte',
          props: { name: 'Ada', filename: ATTACHMENT.filename },
          attachments: [{ filename: ATTACHMENT.filename, content, contentType: ATTACHMENT.contentType }],
        });
        return success({ filename: ATTACHMENT.filename });
      },
    },
  }),
  // Serves the small demo image so the attachment form can preview it.
  '/demos/email/mochi-photo.jpg': Mochi.file(ATTACHMENT.path),
};
