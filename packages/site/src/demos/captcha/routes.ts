import { Mochi, fail, success, mintCaptcha, verifyCaptcha } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/captcha': Mochi.page('./src/demos/captcha/Captcha.svelte', {
    serverProps: () => ({ captcha: mintCaptcha() }),
    actions: {
      submit: async ({ formData }) => {
        const captcha = await verifyCaptcha(formData);
        if (!captcha.ok) {
          return fail(400, { error: captcha.error, reason: captcha.reason });
        }
        const name = String(formData.get('name') ?? '').trim();
        return success({ message: `Verified — nice to meet you, ${name || 'stranger'}.` });
      },

      // Verifies the same token twice: the first call burns the nonce, so the
      // second is a genuine replay rather than a faked message. Lets one click
      // reach the `reason === 'replay'` branch without solving two captchas.
      // An unsolved token fails both calls and lands on 'rejected' instead,
      // which is the other half of what this demonstrates.
      replay: async ({ formData }) => {
        await verifyCaptcha(formData);
        const captcha = await verifyCaptcha(formData);
        if (!captcha.ok) {
          return fail(400, {
            error: captcha.reason === 'replay' ? 'Our own copy: that token is spent — reload for a fresh challenge.' : captcha.error,
            reason: captcha.reason,
          });
        }
        return success({ message: 'Unexpected — the nonce survived a double verify.' });
      },
    },
  }),
};
