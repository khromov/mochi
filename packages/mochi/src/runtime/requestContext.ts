import { AsyncLocalStorage } from 'node:async_hooks';
import type { MochiCookieJar } from './cookies';
import type { IslandPropsEntry } from '../islands/islandPropsRegistry';
import type { MochiFormResult } from '../types';
import type { MochiRateLimitInfo } from './rateLimit';
import type { RequestCacheState } from './requestCache';
import { pinGlobal } from '../utils/globalState';
import { assertServerOnly } from '../utils/serverOnly';

export interface MochiRequestContext {
  /**
   * Stable correlation id for this HTTP request, framework-generated unless `proxy.requestIdHeader` is configured on `Mochi.serve()`.
   * Carried on every lifecycle event for the request (`request`, `error`, `action:invoke`, `action:complete`) so tooling can stitch them together.
   */
  requestId: string;
  request: Request;
  url: URL;
  /** Route parameters extracted by Bun's router (e.g. `{ id: "123" }` for `/item/:id`). */
  params: Record<string, string>;
  /** Per-request data set by middleware. */
  locals: Record<string, unknown>;
  /**
   * `true` when this request was issued by route warmup at startup rather than a real client.
   * Use it to skip side effects (counters, analytics, rate-limit priming) in `serverProps` or components.
   */
  isWarmup: boolean;
  cookies: MochiCookieJar;
  /**
   * Internal per-render scratch space: hydratable-island props keyed by serialized payload, valued by ref id plus emitting-island count.
   * `renderComponent` clears it at the start of every render so sequential same-ctx renders (an error page after a failed render) don't clobber each other.
   */
  islandProps: Map<string, IslandPropsEntry>;
  /**
   * Internal backing store for the request-scoped cache, created on first use so requests that never touch it allocate nothing.
   * Entries die with the request, so an invalidation between requests is seen immediately. Application code goes through `getRequestCache()`.
   */
  requestCache?: RequestCacheState;
  /** Dev-only debug-bar data bag, snapshotted onto `RenderResult.debugBarData` at end of render and surfaced via `window.__mochi_debug`. */
  debugBarData?: DebugBarData;
  /** Result of the form action that just ran, available during POST re-renders of an entry route with `actions`. */
  form?: MochiFormResult;
  /**
   * The client's IP address, defaulting to Bun's connecting `remoteAddress`. Behind a reverse proxy, configure
   * `Mochi.serve({ proxy: { addressHeader: '...' } })`; for `'x-forwarded-for'`, `proxy.xffDepth` sets how many trusted
   * proxies sit in front and the address is read from the right to block spoofing.
   */
  getClientAddress: () => string | null;
  /**
   * Rate-limit state for this request when the matched route has a limiter and the request was allowed: `limit`, `remaining`,
   * `resetIn` (seconds), `resetAt`, `key`, and `tier` when tiered. Read it via `getRequestContext().rateLimit` to render usage.
   */
  rateLimit?: MochiRateLimitInfo;
  /**
   * Present only during an island-endpoint render eligible for nested-island inlining; `budget` caps total inline
   * expansions per request so recursive island chains degrade to placeholders instead of looping.
   */
  islandInline?: { budget: number };
}

export interface BundleInfo {
  url: string;
  label: string;
  sizeBytes: number;
  kind: 'bootstrap' | 'island' | 'chunk';
  inputs: Array<{ path: string; size: number }>;
}

/** One image produced during the request (dev debug bar only). */
export interface ImageDebugEntry {
  /** A `data:` preview of the bytes for `'inline'` entries (empty when over the size cap), the served URL for `'url'` entries. */
  url: string;
  /** Defaults to `url`; inline entries set their variant id so preview-less entries stay distinct on an empty `url`. */
  id?: string;
  filename: string;
  /** The size's resolved, byte-affecting params — src, dimensions, format, quality (or `{ original: true }`). */
  params: Record<string, unknown>;
  /** Defaults to `'url'`. */
  kind?: 'url' | 'inline';
  /** The named size applied, if any — absent for the full-size original. */
  size?: string;
  local?: boolean;
  /** Project-relative path of a local import, so the bar can show `src/…/hero.jpg` in place of the content-hashed served filename. */
  sourcePath?: string;
}

/**
 * SSR-side debug-bar payload, emitted into the cached HTML body and stable across cache hits.
 * The per-request fields live on `DebugBarRuntimeData`, injected client-side by `appendDebugTail`'s trailing `<script>`.
 */
export interface DebugBarData {
  route: string;
  pathname: string;
  params: Record<string, string>;
  /** Always `true` in dev while the page-cache feature is being rebuilt; the debug bar reads it to decide whether to show its Cache panel button. */
  pageCacheEnabled?: boolean;
  /** Cookie names that partition the cache key for this route, currently always empty while the page cache is being rebuilt. */
  varyOnCookies?: string[];
  liveReloadEnabled?: boolean;
  /** Compile check + Svelte render + HTML processing, in milliseconds. */
  ssrDurationMs?: number;
  /** Framework JS bundles injected for this page: bootstrap, island entries, shared chunks. */
  bundles?: BundleInfo[];
  /** Images produced via `getImageUrl()` / `<Image>` / `getImage()` during this request, with decoded params. */
  images?: ImageDebugEntry[];
  requestCache?: RequestCacheStats;
  /** Decoded server-island props keyed by the encrypted `signed-props` token, since the client sees only the opaque token. */
  serverProps?: Record<string, string>;
  mochiVersion?: string;
  svelteVersion?: string;
  bunVersion?: string;
  config?: DebugBarConfig;
}

/** Per-key hit/miss breakdown for the debug bar's expandable key list. */
export interface RequestCacheKeyStats {
  key: string;
  hits: number;
  misses: number;
}

/** Per-request cache counters shown in the debug bar's Cache panel. */
export interface RequestCacheStats {
  hits: number;
  misses: number;
  /** Entries still stored at the end of the render; rejected async entries evict themselves. */
  entries: number;
  /** Every key touched this request with its hit/miss tally, in first-touch order. */
  keys: RequestCacheKeyStats[];
}

/**
 * Descriptive subset of `MochiServeOptions` surfaced in the debug bar's Info panel.
 * Functions (handle, routes, fetch) reduce to booleans or counts so the shape survives `JSON.stringify` into the HTML.
 */
export interface DebugBarConfig {
  mode: 'development' | 'production';
  port?: number;
  hostname?: string;
  debugBar: boolean;
  liveReload: boolean;
  warmup: boolean;
  compressServerIslandProps: boolean;
  trailingSlash: 'never' | 'always';
  assetPrefix?: string;
  logLevel: string;
  middleware: boolean;
  csrf: boolean;
  proxy: boolean;
  markdown: boolean;
  /** Active email transport type. `dev` gates the toolbar's email-viewer link. */
  email: 'log' | 'dev' | 'smtp' | 'custom';
  routeCount: number;
}

/** Shape of `window.__mochi_debug` once the trailing tail script has run, adding the per-request fields populated client-side. */
export interface DebugBarRuntimeData extends DebugBarData {
  /** Pairs rather than a record, to preserve duplicate `Set-Cookie` entries. */
  headers?: Array<[string, string]>;
  requestCookies?: Array<[string, string]>;
}

// TODO: Review this for cross-request security
// Bun's bundler gives each compiled component its own copy of the AsyncLocalStorage, breaking the chain between
// Mochi.ts (which calls `.run()`) and SSR components (which call `.getStore()`), so the instance is pinned globally.
export const requestContext = pinGlobal('__mochi_request_context__', () => new AsyncLocalStorage<MochiRequestContext>());

// Covers framework code deep-importing this module; `mochi-env.client.js` stubs the public `getRequestContext` export.
const SERVER_ONLY_REASON = 'The request context is server-only. Read what you need during SSR and pass it down as a prop, or through Svelte’s hydratable().';

/**
 * The current request context, available in any server-side code running within a request (components, API handlers, helpers).
 *
 * ```svelte
 * <script>
 *   import { getRequestContext } from "mochi-framework";
 *   const { params, locals, url } = getRequestContext();
 * </script>
 * ```
 */
export function getRequestContext(): MochiRequestContext {
  assertServerOnly('getRequestContext()', SERVER_ONLY_REASON);
  const ctx = requestContext.getStore();
  if (!ctx) {
    throw new Error('getRequestContext() called outside of a request. ' + 'It is only available in server-side code running within a Mochi request handler.');
  }
  return ctx;
}

/**
 * Runs `fn` with the request context cleared, so `getRequestContext()` and anything built on it throws throughout —
 * used by the stateless render path (email/static).
 *
 * Contract — do NOT loosen:
 *  - This wrapper owns the `await`, so the render runs while the store is cleared
 *    even though `render()` from svelte/server is a *lazy thenable* (the component
 *    executes in a microtask when awaited). `fn` may be a plain thunk returning
 *    that thenable; this wrapper awaits it inside the cleared scope.
 *  - `fn` MUST read any lazy getters (Svelte render `body`/`head`) and return plain
 *    values, so materialization also happens in the cleared scope — never return the
 *    live render object and read its getters at the call site (that reads under the
 *    restored ambient context).
 * The assertion is a tripwire if either invariant regresses.
 */
export async function renderDetached<T>(fn: () => Promise<T>): Promise<T> {
  assertServerOnly('renderDetached()', SERVER_ONLY_REASON);
  return requestContext.exit(async () => {
    if (requestContext.getStore() !== undefined) {
      throw new Error('renderDetached: request context was not cleared — isolation failed');
    }
    return await fn();
  });
}
