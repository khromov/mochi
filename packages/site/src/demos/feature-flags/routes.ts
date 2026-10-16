import { Mochi, error, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Flags are declared once in Mochi.serve({ features }) (see index.ts):
//   features: { 'demo-new-hero': { rollout: 0.5 }, 'demo-beta-badge': { rollout: 0.5 } }
const DEMO_FLAGS = ['demo-new-hero', 'demo-beta-badge'];

export const routes: Record<string, MochiRouteValue> = {
  '/demos/feature-flags': Mochi.page('./src/demos/feature-flags/FeatureFlags.svelte', {
    // Evaluate flags server-side and pass the booleans down as props — the
    // hydration-safe pattern. The first check mints the encrypted `mochi_ff`
    // cookie, so the response also gets `Vary: Cookie`.
    serverProps: () => {
      const flags = DEMO_FLAGS.map((name) => ({ name, on: Mochi.feature(name) }));
      const cookie = getRequestContext().cookies.get('mochi_ff') ?? null;
      return { flags, cookie };
    },
  }),
  // Clear the assignment so the next load re-rolls this user's buckets.
  '/api/feature-flags/reset': Mochi.api(({ method }) => {
    if (method !== 'POST') {
      error(405, 'Method Not Allowed');
    }
    getRequestContext().cookies.delete('mochi_ff', { path: '/' });
    return Response.json({ ok: true });
  }),
};
