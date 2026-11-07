import { Mochi, mintCaptcha } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/captcha-styling': Mochi.page('./src/demos/captcha-styling/CaptchaStyling.svelte', {
    // One token per variant so each can be solved independently.
    serverProps: () => ({ captchas: [mintCaptcha(), mintCaptcha(), mintCaptcha(), mintCaptcha()] }),
  }),
};
