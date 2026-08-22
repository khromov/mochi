import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Used only by `bun run test:leak`; mirrors `/demos/server-island`'s code path minus the
// artificial 1–3s `delay()`, which would otherwise dominate the leak harness's latency stats.
export const routes: Record<string, MochiRouteValue> = {
  '/__leak/server-island': Mochi.page('./src/leak-test/LeakIslandPage.svelte'),
};
