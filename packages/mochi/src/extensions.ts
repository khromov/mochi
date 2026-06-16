/**
 * Extension API for the framework.
 *
 * Two surfaces:
 *  - `hooks` run a user function at a specific framework moment (no return).
 *  - `filters` replace a framework default value (user receives the existing
 *    value and returns the new one).
 *
 * Only one entry per name — no priorities, no chains.
 *
 * Names use a `namespace:camelCase` string convention. New extension points are
 * added by extending the four interfaces below; the kind map declares whether
 * each entry is consumed in sync or async context. TypeScript narrows the user
 * callback accordingly and the runtime invoker matches.
 */

import type { Server } from 'bun';
import type { PreprocessorGroup } from 'svelte/compiler';
import type { CookieSerializeOptions } from './cookies';
import type { MochiServeOptions } from './types';
import type { MochiEventMap, MochiRequestKind } from './events';
import type { TrailingSlashPolicy } from './trailingSlash';
import { pinGlobal } from './globalState';

/**
 * Discriminated union of every `mochiEvents` payload that `consoleLogger()`
 * formats into a line. Narrow on `name` to access typed per-event fields
 * (e.g. `requestId` on `'request'`, `size` on `'ws:message'`).
 */
export type ConsoleLoggerSource = {
  [K in keyof MochiEventMap]: { name: K; payload: MochiEventMap[K] };
}[keyof MochiEventMap];

// ---------------------------------------------------------------------------
// Registry: hooks
// ---------------------------------------------------------------------------

export interface MochiHookContext {
  'mochi:init': { options: MochiServeOptions };
  'mochi:ready': { options: MochiServeOptions; server: Server<undefined> };
  'mochi:shutdown': {
    options: MochiServeOptions;
    server: Server<undefined>;
    signal: NodeJS.Signals;
  };
  'route:matched': {
    pattern: string;
    request: Request;
    url: URL;
    params: Record<string, string>;
    kind: 'page' | 'api' | 'ws' | 'sse' | 'file';
  };
}

export interface MochiHookKindMap {
  'mochi:init': 'async';
  'mochi:ready': 'async';
  'mochi:shutdown': 'async';
  'route:matched': 'sync';
}

type Hook<K extends keyof MochiHookContext> = MochiHookKindMap[K] extends 'async' ? (ctx: MochiHookContext[K]) => void | Promise<void> : (ctx: MochiHookContext[K]) => void;

export type MochiHooks = { [K in keyof MochiHookContext]?: Hook<K> };

// ---------------------------------------------------------------------------
// Registry: filters
// ---------------------------------------------------------------------------

export interface MochiFilterValue {
  'csrf:formContentTypes': Set<string>;
  'csrf:protectedMethods': Set<string>;
  'csrf:trustedOrigins': Set<string>;
  'csrf:check': Response | null;
  'trailingSlash:redirect': Response | null;
  'cookie:defaults': CookieSerializeOptions;
  'html:shell': string;
  'serverIsland:secretKey': Buffer;
  'compile:preprocessors': PreprocessorGroup[];
  'publicDir:scan': Map<string, string>;
  'consoleLogger:line': string;
}

// Optional per-filter override for the *return* type when it differs from the
// input type. Most filters are symmetric (user receives V[K] and returns V[K])
// so this map is sparse — only listed entries diverge. Defaults to
// `MochiFilterValue[K]` when a key is absent.
export interface MochiFilterReturn {
  'consoleLogger:line': string | null;
}

export interface MochiFilterContext {
  'csrf:formContentTypes': { options: MochiServeOptions };
  'csrf:protectedMethods': { options: MochiServeOptions };
  'csrf:trustedOrigins': { options: MochiServeOptions };
  'csrf:check': { request: Request; url: URL };
  'trailingSlash:redirect': { request: Request; url: URL; policy: TrailingSlashPolicy };
  'cookie:defaults': { options: MochiServeOptions };
  'html:shell': { options: MochiServeOptions; development: boolean };
  'serverIsland:secretKey': { options: MochiServeOptions; envKeyPresent: boolean };
  'compile:preprocessors': {
    filename: string;
    target: 'server' | 'client';
    development: boolean;
  };
  'publicDir:scan': { publicDir: string; development: boolean };
  'consoleLogger:line': {
    /** Resolved log level (escalated to `'warn'` for 5xx / slow requests). */
    level: 'info' | 'warn' | 'log' | 'debug';
    /** 4-char event tag — `'GET '`, `'POST'`, `'WS  '`, `'BOOT'`, `'BUILD'`, `'CACHE'`, … */
    label: string;
    /** The path/key/identifier shown in the line. For requests this is the URL path; for cache events it's the cache key; for compile events it's the source file. */
    path: string;
    /** HTTP status — present only for request lines. */
    status?: number;
    /** Request kind — present only for request lines. */
    kind?: MochiRequestKind;
    /** The originating `mochiEvents` event. Narrow on `source.name` for typed access to per-event fields. */
    source: ConsoleLoggerSource;
  };
}

export interface MochiFilterKindMap {
  'csrf:formContentTypes': 'sync';
  'csrf:protectedMethods': 'sync';
  'csrf:trustedOrigins': 'sync';
  'csrf:check': 'sync';
  'trailingSlash:redirect': 'sync';
  'cookie:defaults': 'sync';
  'html:shell': 'sync';
  'serverIsland:secretKey': 'async';
  'compile:preprocessors': 'sync';
  'publicDir:scan': 'async';
  'consoleLogger:line': 'sync';
}

type FilterReturn<K extends keyof MochiFilterValue> = K extends keyof MochiFilterReturn ? MochiFilterReturn[K] : MochiFilterValue[K];

type Filter<K extends keyof MochiFilterValue> = MochiFilterKindMap[K] extends 'async'
  ? (value: MochiFilterValue[K], ctx: MochiFilterContext[K]) => FilterReturn<K> | Promise<FilterReturn<K>>
  : (value: MochiFilterValue[K], ctx: MochiFilterContext[K]) => FilterReturn<K>;

export type MochiFilters = { [K in keyof MochiFilterValue]?: Filter<K> };

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

// Runtime kind tables mirror the TypeScript kind maps above. Adding a new
// extension point means an entry in BOTH (the type map for compile-time
// narrowing and the runtime table so the invoker knows whether to await).
// The value type is widened to `'sync' | 'async'` so the runtime comparisons
// below stay reachable when every current entry happens to share one kind.
type MochiKind = 'sync' | 'async';
const HOOK_KINDS: { [K in keyof MochiHookContext]: MochiKind } = {
  'mochi:init': 'async',
  'mochi:ready': 'async',
  'mochi:shutdown': 'async',
  'route:matched': 'sync',
};
const FILTER_KINDS: { [K in keyof MochiFilterValue]: MochiKind } = {
  'csrf:formContentTypes': 'sync',
  'csrf:protectedMethods': 'sync',
  'csrf:trustedOrigins': 'sync',
  'csrf:check': 'sync',
  'trailingSlash:redirect': 'sync',
  'cookie:defaults': 'sync',
  'html:shell': 'sync',
  'serverIsland:secretKey': 'async',
  'compile:preprocessors': 'sync',
  'publicDir:scan': 'async',
  'consoleLogger:line': 'sync',
};

// Pinned on globalThis so duplicate bundled copies of mochi-framework share one
// registry — same reasoning as the AsyncLocalStorage in `requestContext.ts`.
// One registry per process is fine because `initMochiConfig` already forbids
// calling `Mochi.serve()` more than once.
const registry = pinGlobal<{ eventHooks: MochiHooks; filters: MochiFilters }>('__mochi_extensions_registry__', () => ({ eventHooks: {}, filters: {} }));

export function initExtensions(opts: Pick<MochiServeOptions, 'eventHooks' | 'filters'>): void {
  registry.eventHooks = opts.eventHooks ?? {};
  registry.filters = opts.filters ?? {};
}

// `runHook` returns Promise<void> for async-kind names, void for sync-kind.
// The runtime dispatches on the runtime kind table to guarantee the actual
// return matches the type — including when no user fn is registered.
export function runHook<K extends keyof MochiHookContext>(name: K, ctx: MochiHookContext[K]): MochiHookKindMap[K] extends 'async' ? Promise<void> : void {
  const fn = registry.eventHooks[name] as Hook<K> | undefined;
  if (HOOK_KINDS[name] === 'async') {
    return Promise.resolve(fn?.(ctx)) as never;
  }
  fn?.(ctx);
  return undefined as never;
}

// `applyFilter` returns the filtered value (or the input unchanged when no fn
// is registered). Async-kind filters may return a Promise; the conditional
// return type forces the caller to await in those cases.
export function applyFilter<K extends keyof MochiFilterValue>(
  name: K,
  value: MochiFilterValue[K],
  ctx: MochiFilterContext[K],
): MochiFilterKindMap[K] extends 'async' ? FilterReturn<K> | Promise<FilterReturn<K>> : FilterReturn<K> {
  const fn = registry.filters[name] as Filter<K> | undefined;
  if (FILTER_KINDS[name] === 'async') {
    if (!fn) {
      return Promise.resolve(value) as never;
    }
    return fn(value, ctx) as never;
  }
  if (!fn) {
    return value as never;
  }
  return fn(value, ctx) as never;
}
