export const isServer = false; export const isBrowser = true; export const DEV = __MOCHI_DEV__; export const isDev = __MOCHI_DEV__;
// Always false in the browser: a build never runs client-side, so nothing that executes here is ever mid-build.
export const isBuilding = false;
// Shared thrower for the server-only stubs below. Each stub stays a pure
// declaration (tree-shaken when unused); this helper is pulled in only if one is.
const __serverOnly = (n) => { throw new Error(n + " is only available on the server"); };
export function getRequestContext() { __serverOnly("getRequestContext()"); }
// Lazy cookie jar + /*@__PURE__*/ initializers keep this module tree-shakeable:
// if an island imports only e.g. `logger`, the bundler drops `cookies` and the
// whole cookies.client.ts tree instead of eagerly evaluating __cc() at load.
import { createClientCookies as __cc } from "__MOCHI_COOKIES_CLIENT__";
let __clientCookies;
const __getClientCookies = () => (__clientCookies ??= __cc());
export const cookies = /*@__PURE__*/ new Proxy({}, {
  get(_, p) {
    const c = __getClientCookies();
    const r = c[p];
    return typeof r === "function" ? r.bind(c) : r;
  },
});
const __mochiServerOnly = (n) => new Proxy({}, { get() { __serverOnly(n); } });
export const params = /*@__PURE__*/ __mochiServerOnly("params");
const __loc = () => new URL(window.location.href);
export const url = /*@__PURE__*/ new Proxy({}, {
  get(_, p) {
    const v = __loc();
    const r = v[p];
    return typeof r === "function" ? r.bind(v) : r;
  },
  set() { return false; },
  has(_, p) { return p in __loc(); },
  ownKeys() { return Reflect.ownKeys(__loc()); },
  getOwnPropertyDescriptor(_, p) {
    const d = Object.getOwnPropertyDescriptor(__loc(), p);
    if (d) d.configurable = true;
    return d;
  },
});
export const locals = /*@__PURE__*/ __mochiServerOnly("locals");
// Re-export the isomorphic logger and apply the level seeded by the
// server in window.__mochi_log_level (set by Mochi.serve via the HTML
// shell). devWarn keeps routing through window.__mochi_warn so the
// debug-bar's warnings panel still receives entries.
import { logger as __mochi_logger, setLogLevel, getLogLevel } from "__MOCHI_LOG__";
export { setLogLevel, getLogLevel };
export const logger = __mochi_logger;
if (typeof window !== "undefined" && window.__mochi_log_level) setLogLevel(window.__mochi_log_level);
export function devWarn(msg) { if (typeof window !== "undefined" && window.__mochi_warn) window.__mochi_warn(msg); else __mochi_logger.warn(msg); }
// Isomorphic: pins a value on globalThis (per realm in the browser). Real re-export,
// not a server-only stub, so island code can dedupe singletons on the client too.
export { pinGlobal } from "__MOCHI_GLOBAL_STATE__";
export { stringify, parse } from "__MOCHI_DEVALUE__";
export { trailingSlashIt } from "__MOCHI_TRAILING_SLASH__";
// Server-only; the preprocessor never injects __mochi_emit_props__
// into client bundles, but this stub keeps the module surface
// symmetric and produces a clear error if anyone imports it.
export function emitIslandProps() { __serverOnly("emitIslandProps()"); }
// mochiEvents is a server-side bus. On the client we ship a stub so
// bundles don't pull in mitt and accidental emits surface in the
// console instead of silently misbehaving. Subscribers registered
// client-side never fire — nothing emits here.
export const mochiEvents = {
  all: new Map(),
  on() {},
  off() {},
  setHandler() {},
  removeHandler() {},
  emit(type) {
    __mochi_logger.warn(
      "mochiEvents.emit(" + JSON.stringify(type) + ") was called in the browser. " +
      "mochiEvents is server-only; client-side emits are no-ops."
    );
  },
};
// The request cache is server-only, but an island's top-level code runs again
// during hydration — so these degrade to uncached pass-through rather than
// throwing and breaking the hydration pass. A one-time dev warning flags the
// mismatch, since on the client they run uncached and see none of the server's
// cached values (usually not what a hydrated component wants).
let __warnedRequestCache = false;
function __warnRequestCache(name) {
  if (!DEV || __warnedRequestCache) return;
  __warnedRequestCache = true;
  devWarn(
    name + " ran in the browser. The request cache is server-only; on the client it runs " +
    "uncached and does not replay the server's values. Use it in server-only code or " +
    "non-hydrated islands, or Svelte's hydratable() to reuse a server value after hydration."
  );
}
export function requestCache(_key, fn) { __warnRequestCache("requestCache()"); return fn(); }
export function requestMemo(fn) {
  return (...args) => { __warnRequestCache("requestMemo()"); return fn(...args); };
}
export function getRequestCache() {
  __warnRequestCache("getRequestCache()");
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); },
    has: (k) => m.has(k),
    delete: (k) => m.delete(k),
    clear: () => { m.clear(); },
    getOrSet: (k, fn) => (m.has(k) ? m.get(k) : (m.set(k, fn()), m.get(k))),
    get size() { return m.size; },
    stats: () => ({ hits: 0, misses: 0 }),
  };
}
// MochiCache + storage adapters are server-only; ship stubs that throw so
// accidental client imports surface clearly instead of failing the bundle.
export class MochiCache { constructor() { __serverOnly("MochiCache"); } }
export class MemoryStorage { constructor() { __serverOnly("MemoryStorage"); } }
export class FileStorage { constructor() { __serverOnly("FileStorage"); } }
// Blob refs only exist in server-side cache reads; isBlobRef is safe
// to answer false in the browser, readBlobRef is a usage error.
export function isBlobRef() { return false; }
export function readBlobRef() { __serverOnly("readBlobRef()"); }
// Image helpers are server-only (signing/fetch/disk-cache); ship throwing stubs.
// getImageUrl/warmImagePlaceholder degrade to no-ops rather than throwing:
// <Image> may re-mint on the client after hydration (with the raw src) and
// warm-placeholder is best-effort, so a throw there would break hydration.
export function getImageUrl(src) { return src; }
export function getImageAttrs(src) { return { url: src }; }
export function warmImagePlaceholder() {}
export function getImage() { __serverOnly("getImage()"); }
export function getImagePlaceholder() { return Promise.resolve(null); }
export function imagePlaceholder() { return Promise.resolve(null); }
export function invalidateImage() { __serverOnly("invalidateImage()"); }
// Feature flags are per-user and evaluated server-side. In a hydrated island,
// evaluate in a server island or pass the boolean down as a prop rather than
// calling feature() during client hydration.
export function feature() { throw new Error("feature() is only available on the server. In a hydrated island, evaluate it server-side and pass the result down as a prop."); }
export function setFeatureOverride() { __serverOnly("setFeatureOverride()"); }
export { reloadDeferredIsland, reloadDeferredIslandAll } from "__MOCHI_DEFER_API__";
export { deferReloadState, DeferReloadState } from "__MOCHI_DEFER_REACTIVE__";
export function memoryStore() { __serverOnly("memoryStore()"); }
export function sqliteStore() { __serverOnly("sqliteStore()"); }
export function postgresStore() { __serverOnly("postgresStore()"); }
export { enhance, deserialize } from "__MOCHI_ENHANCE_CLIENT__";
// Constant by construction: client bundles are built only for islands, so
// every component that executes in the browser is part of a hydrating (or
// client-only mounting) subtree. No context lookup needed.
export function isHydratable() { return true; }
// Server filesystem path — meaningless in the browser.
export const PROTECTION_SHELL_COMPONENT = undefined;
