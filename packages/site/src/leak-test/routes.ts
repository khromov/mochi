import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import LeakIslandPage from './LeakIslandPage.svelte';

// Internal route used only by `bun run test:leak`. Hits the same code path as
// the public `/demos/server-island` page (page render + deferred island endpoint
// with signed props) but without the artificial 1–3s `delay()` that would
// dominate the leak harness's latency stats.
export const routes: Record<string, MochiRouteValue> = {
  '/__leak/server-island': Mochi.page(LeakIslandPage),
};
