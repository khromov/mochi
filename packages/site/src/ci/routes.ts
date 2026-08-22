import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { getCiDashboard, getLastRateLimit } from '../lib/ci';
import { buildDocsNav } from '../lib/docs';

export const routes: Record<string, MochiRouteValue> = {
  '/ci': Mochi.page('./src/ci/CiPage.svelte', {
    serverProps: async () => {
      const dashboard = await getCiDashboard();
      return {
        docsNav: await buildDocsNav(),
        dashboard,
        rateLimit: dashboard?.rateLimit ?? getLastRateLimit(),
        // The island seeds its clock from this so SSR and hydration agree.
        serverNow: Date.now(),
      };
    },
  }),

  // Chrome-free variant for a small always-on display — same data, no nav or hero.
  '/ci/dashboard': Mochi.page('./src/ci/DashboardPage.svelte', {
    serverProps: async () => {
      const dashboard = await getCiDashboard();
      return { dashboard, rateLimit: dashboard?.rateLimit ?? getLastRateLimit(), serverNow: Date.now() };
    },
  }),

  // Always 200, even when GitHub is unreachable: a null `dashboard` lets the island
  // tell "GitHub is down" (render the degraded card) apart from "our route broke"
  // (keep the last board and flag the failed refresh). A 503 collapses the two.
  '/ci/data': Mochi.api(async () => {
    const dashboard = await getCiDashboard();
    return Response.json({ dashboard, rateLimit: dashboard?.rateLimit ?? getLastRateLimit(), serverNow: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
  }),
};
