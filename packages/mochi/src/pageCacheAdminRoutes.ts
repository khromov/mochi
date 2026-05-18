import type { MochiApiConfig, MochiPageConfig } from './types';

export const PAGE_CACHE_ADMIN_PATH = '/__mochi/admin/page-cache';

export const PAGE_CACHE_ADMIN_COMPONENT = new URL('./templates/PageCacheAdmin/PageCacheAdmin.svelte', import.meta.url).pathname;

// Placeholder shapes — the real page-cache implementation is being rebuilt.
// Until then the admin UI renders these stubs and purge actions are no-ops.
type StubEntry = {
  key: string;
  path: string;
  search: string;
  status: number;
  contentEncoding: string;
  bodySize: number;
  cachedAt: number;
  hits: number;
};

type StubStats = {
  size: number;
  totalBytes: number;
};

const STUB_STATS: StubStats = { size: 3, totalBytes: 12345 };

const STUB_ENTRIES: StubEntry[] = [
  { key: 'GET /', path: '/', search: '', status: 200, contentEncoding: 'br', bodySize: 4321, cachedAt: Date.now() - 12_000, hits: 17 },
  { key: 'GET /docs/intro', path: '/docs/intro', search: '', status: 200, contentEncoding: 'gzip', bodySize: 6789, cachedAt: Date.now() - 90_000, hits: 4 },
  { key: 'GET /api/health', path: '/api/health', search: '', status: 200, contentEncoding: 'identity', bodySize: 1235, cachedAt: Date.now() - 5_000, hits: 42 },
];

// Built as plain `__mochiPage` / `__mochiApi` literals rather than via
// `Mochi.page()` / `Mochi.api()` because Mochi.ts already imports from this
// module, and going through the helpers would create a circular import.
export function buildPageCacheAdminRoutes(): Record<string, MochiPageConfig | MochiApiConfig> {
  return {
    [PAGE_CACHE_ADMIN_PATH]: {
      __mochiPage: true,
      componentPath: PAGE_CACHE_ADMIN_COMPONENT,
      serverProps: () => ({ stats: STUB_STATS, entries: STUB_ENTRIES }),
      actions: {
        purgeAll: () => undefined,
        purge: ({ formData }) => {
          // Keep the formData lookup so the front-end form contract is unchanged
          // for when the real cache returns; right now it's a no-op.
          formData.get('path');
          return undefined;
        },
      },
    },
    [`${PAGE_CACHE_ADMIN_PATH}/stats`]: {
      __mochiApi: true,
      handler: () => Response.json(STUB_STATS, { headers: { 'Cache-Control': 'no-store' } }),
    },
    [`${PAGE_CACHE_ADMIN_PATH}/entries`]: {
      __mochiApi: true,
      handler: () => Response.json(STUB_ENTRIES, { headers: { 'Cache-Control': 'no-store' } }),
    },
  };
}
