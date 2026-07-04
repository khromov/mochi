import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { DEMO_TO, presetById } from './presets';

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
    },
  }),
};
