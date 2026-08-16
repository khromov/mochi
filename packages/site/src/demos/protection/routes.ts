import { Mochi, success, PROTECTION_CLEARANCE_COOKIE } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/protection': Mochi.page('./src/demos/protection/Protection.svelte', {
    actions: {
      reset: async ({ cookies }) => {
        cookies.delete(PROTECTION_CLEARANCE_COOKIE, { path: '/' });
        return success({ cleared: true });
      },
    },
  }),
  '/demos/protection/protected': Mochi.page('./src/demos/protection/ProtectedPage.svelte'),
  '/demos/protection/api': Mochi.api(async () => Response.json({ ok: true, message: 'You are cleared — this API answered.' })),
};
