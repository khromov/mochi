import { Mochi, fail, success, mintCaptcha, verifyCaptcha } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/captcha': Mochi.page('./src/demos/captcha/Captcha.svelte', {
    serverProps: () => ({ captcha: mintCaptcha() }),
    actions: {
      submit: async ({ formData }) => {
        const captcha = await verifyCaptcha(formData);
        if (!captcha.ok) {
          return fail(400, { error: captcha.error });
        }
        const name = String(formData.get('name') ?? '').trim();
        return success({ message: `Verified — nice to meet you, ${name || 'stranger'}.` });
      },
    },
  }),
};
