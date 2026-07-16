export const isServer = false; export const isBrowser = true; export const DEV = __MOCHI_DEV__; export const isDev = __MOCHI_DEV__;
export function getRequestContext() { throw new Error("getRequestContext() is only available on the server"); }
import { createClientCookies as __cc } from "__MOCHI_COOKIES_CLIENT__";
const __clientCookies = __cc();
export const cookies = new Proxy({}, {
  get(_, p) {
    const r = __clientCookies[p];
    return typeof r === "function" ? r.bind(__clientCookies) : r;
  },
});
const __mochiServerOnly = (n) => new Proxy({}, {
  get() { throw new Error(n + " is only available on the server"); },
});
export const params = __mochiServerOnly("params");
const __loc = () => new URL(window.location.href);
export const url = new Proxy({}, {
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
export const locals = __mochiServerOnly("locals");
// Re-export the isomorphic logger and apply the level seeded by the
// server in window.__mochi_log_level (set by Mochi.serve via the HTML
// shell). devWarn keeps routing through window.__mochi_warn so the
// debug-bar's warnings panel still receives entries.
import { logger as __mochi_logger, setLogLevel, getLogLevel } from "__MOCHI_LOG__";
export { setLogLevel, getLogLevel };
export const logger = __mochi_logger;
if (typeof window !== "undefined" && window.__mochi_log_level) setLogLevel(window.__mochi_log_level);
export function devWarn(msg) { if (typeof window !== "undefined" && window.__mochi_warn) window.__mochi_warn(msg); else __mochi_logger.warn(msg); }
export { stringify, parse } from "__MOCHI_DEVALUE__";
export { trailingSlashIt } from "__MOCHI_TRAILING_SLASH__";
// Server-only; the preprocessor never injects __mochi_emit_props__
// into client bundles, but this stub keeps the module surface
// symmetric and produces a clear error if anyone imports it.
export function emitIslandProps() { throw new Error("emitIslandProps() is only available on the server"); }
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
// MochiCache is server-only; ship a stub that throws so accidental
// client imports surface clearly instead of failing the bundle.
export class MochiCache { constructor() { throw new Error("MochiCache is only available on the server"); } }
// Cache storage adapters are server-only; ship throwing stubs too.
export class MemoryStorage { constructor() { throw new Error("MemoryStorage is only available on the server"); } }
export class FileStorage { constructor() { throw new Error("FileStorage is only available on the server"); } }
// Blob refs only exist in server-side cache reads; isBlobRef is safe
// to answer false in the browser, readBlobRef is a usage error.
export function isBlobRef() { return false; }
export function readBlobRef() { throw new Error("readBlobRef() is only available on the server"); }
// Image helpers are server-only (signing/fetch/disk-cache); ship throwing stubs.
// getImageUrl/warmImagePlaceholder degrade to no-ops rather than throwing:
// <Image> may re-mint on the client after hydration (with the raw src) and
// warm-placeholder is best-effort, so a throw there would break hydration.
export function getImageUrl(src) { return src; }
export function getImageAttrs(src) { return { url: src }; }
export function warmImagePlaceholder() {}
export function getImage() { throw new Error("getImage() is only available on the server"); }
export function getImagePlaceholder() { return Promise.resolve(null); }
export function imagePlaceholder() { return Promise.resolve(null); }
export function invalidateImage() { throw new Error("invalidateImage() is only available on the server"); }
export function memoryStore() { throw new Error("memoryStore() is only available on the server"); }
export function sqliteStore() { throw new Error("sqliteStore() is only available on the server"); }
export function postgresStore() { throw new Error("postgresStore() is only available on the server"); }
export { enhance, deserialize } from "__MOCHI_ENHANCE_CLIENT__";
