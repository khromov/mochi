export const isServer = true; export const isBrowser = false; export const DEV = __MOCHI_DEV__; export const isDev = __MOCHI_DEV__;
// Always false in components: they are compiled but never executed during a build, so a compiled component only ever runs while serving.
export const isBuilding = false;
export function getRequestContext() {
  const ctx = globalThis.__mochi_request_context__?.getStore();
  if (!ctx) throw new Error("getRequestContext() called outside of a request.");
  return ctx;
}
function __mochiCtxProxy(key) {
  return new Proxy({}, {
    get(_, p) {
      const v = getRequestContext()[key];
      const r = v[p];
      return typeof r === "function" ? r.bind(v) : r;
    },
    has(_, p) { return p in getRequestContext()[key]; },
    ownKeys() { return Reflect.ownKeys(getRequestContext()[key]); },
    getOwnPropertyDescriptor(_, p) {
      const d = Object.getOwnPropertyDescriptor(getRequestContext()[key], p);
      if (d) d.configurable = true;
      return d;
    },
  });
}
export const cookies = __mochiCtxProxy("cookies");
export const params  = __mochiCtxProxy("params");
export const url     = __mochiCtxProxy("url");
export const locals  = __mochiCtxProxy("locals");
// Single source of truth for `logger` lives in log.ts. Re-export here
// (and on the client) so user code does `import { logger } from
// 'mochi-framework'` and gets the level-gated, isomorphic logger.
import { logger as __mochi_logger, setLogLevel, getLogLevel } from "__MOCHI_LOG__";
export { setLogLevel, getLogLevel };
export const logger = __mochi_logger;
export function devWarn(msg) { __mochi_logger.warn(msg); }
// Isomorphic: pins a value on globalThis so duplicate bundled copies share one
// instance per process. Re-exported so .svelte-graph modules can dedupe singletons.
export { pinGlobal } from "__MOCHI_GLOBAL_STATE__";
// Re-export devalue so .svelte files (and the preprocessor's
// injected hydration-prop import) can use stringify/parse without
// a separate install. Resolved from the framework's own deps.
export { stringify, parse } from "__MOCHI_DEVALUE__";
export { trailingSlashIt } from "__MOCHI_TRAILING_SLASH__";
// Per-request hydratable-island props dedup helper. Used by the
// preprocessor's injected `__mochi_emit_props__` import.
export { emitIslandProps } from "__MOCHI_ISLAND_PROPS__";
// Context-backed: true anywhere inside an island subtree that will hydrate
// (seeded by the preprocessor's injected prologue on the island root).
export { isHydratable } from "__MOCHI_IS_HYDRATABLE__";
// Expose the event bus. Pinned on globalThis under the same key as
// `events.ts` so the bundled copy and the real server runtime share
// one emitter instance.
import __mochi_mitt__ from "__MOCHI_MITT__";
if (!globalThis.__mochi_events__) globalThis.__mochi_events__ = __mochi_mitt__();
export const mochiEvents = globalThis.__mochi_events__;
// Server-side cache class. Re-exported through the virtual module so .svelte
// files can `import { MochiCache } from 'mochi-framework'` directly.
export { MochiCache } from "__MOCHI_CACHE__";
// Request-scoped cache. Server-only (it hangs off the request context).
export { requestCache, requestMemo, getRequestCache } from "__MOCHI_REQUEST_CACHE__";
// Cache storage adapters — server-only (FileStorage touches the fs).
// isBlobRef/readBlobRef resolve the lazy blob references a
// FileStorage-backed cache returns for binary fields.
export { MemoryStorage, FileStorage, isBlobRef, readBlobRef } from "__MOCHI_CACHE_STORAGE__";
// Image helpers. Server-only (signing needs the secret key); re-exported
// so .svelte files can `import { getImageUrl } from 'mochi-framework'`.
export { getImageUrl, getImageAttrs, getImage, getImagePlaceholder, imagePlaceholder, warmImagePlaceholder, invalidateImage } from "__MOCHI_IMAGE_API__";
// Deferred-island reload API. Isomorphic and server-safe: the island registry is
// empty during SSR, so these resolve immediately on the server and only do work
// in the browser where the `<mochi-server-island>` elements register themselves.
export { reloadDeferredIsland, reloadDeferredIslandAll, isReloadingDeferredIsland } from "__MOCHI_DEFER_API__";
export { deferReloadState, DeferReloadState } from "__MOCHI_DEFER_REACTIVE__";
// `enhance` / `deserialize` are browser-only Svelte action helpers.
// Svelte never invokes actions during SSR, so these stubs only fire
// if user code calls them on the server — which is a usage error.
export { enhance, deserialize } from "__MOCHI_ENHANCE_SSR__";
// Rate-limit stores — server-only (bun:sqlite / Bun SQL).
export { memoryStore, sqliteStore, postgresStore } from "__MOCHI_RATE_LIMIT__";
