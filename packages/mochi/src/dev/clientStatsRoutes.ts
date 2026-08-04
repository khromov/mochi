import type { ComponentRegistry } from '../compiler/ComponentRegistry';
import { bothSlashForms } from '../runtime/trailingSlash';
import type { MochiPageConfig } from '../types';

export const CLIENT_STATS_COMPONENT = Bun.fileURLToPath(new URL('../templates/ClientStats/ClientStats.svelte', import.meta.url));

// Built as a `__mochiPage` literal rather than via `Mochi.page()` because
// Mochi.ts already imports from this module — going through the helper would
// create a circular import. Same dodge as `pageCacheAdminRoutes.ts`.
export function buildClientStatsRoutes(registry: ComponentRegistry): Record<string, MochiPageConfig> {
  const path = `${registry.assetPrefix}/client/stats`;
  const config: MochiPageConfig = {
    __mochiPage: true,
    componentPath: CLIENT_STATS_COMPONENT,
    serverProps: () => ({
      stats: registry.getClientStats() ?? { outputs: [] },
    }),
  };
  return bothSlashForms(path, config);
}
