/**
 * Extension API for the framework, across two surfaces: `hooks` run a user function at a specific framework moment,
 * while `filters` receive a framework default value and return its replacement. One entry per `namespace:camelCase`
 * name, with no priorities or chains.
 *
 * New extension points extend the four interfaces below, and the kind map declares whether each entry is consumed in
 * sync or async context so TypeScript and the runtime invoker agree.
 */

import type { Server } from 'bun';
import type { PreprocessorGroup } from 'svelte/compiler';
import type { CookieSerializeOptions } from './runtime/cookies';
import type { MochiCaptchaOptions } from './captcha/types';
import type { MochiServeOptions } from './types';
import type { MochiEventMap, MochiRequestKind } from './events';
import type { ResolvedEmailMessage, MochiEmailTransportConfig } from './email/types';
import type { ImportedImageFormat } from './image/types';
import type { TrailingSlashPolicy } from './runtime/trailingSlash';
import { pinGlobal } from './utils/globalState';
import { assertServerOnly } from './utils/serverOnly';
import { markStartupMilestone } from './lifecycle';
import type { MochiStartupMilestone } from './lifecycle';

const STARTUP_MILESTONE_HOOKS = new Set<string>(['mochi:init', 'mochi:listening', 'mochi:queuesMounted', 'mochi:ready']);

/**
 * Every `mochiEvents` payload that `consoleLogger()` formats into a line. Narrow on `name` for typed per-event fields —
 * `requestId` on `'request'`, `size` on `'ws:message'`.
 */
export type ConsoleLoggerSource = {
  [K in keyof MochiEventMap]: { name: K; payload: MochiEventMap[K] };
}[keyof MochiEventMap];

/** The severities `consoleLogger()` writes through: a subset of `LogLevel`, since `'error'` is reserved for thrown failures and `'silent'` is a global setting. */
export type ConsoleLoggerLevel = 'info' | 'warn' | 'log' | 'debug';

/** What identifies a console-logger line — shared by the `consoleLogger:level` and `consoleLogger:line` filter contexts. */
export interface ConsoleLoggerLine {
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
}

export interface MochiHookContext {
  'mochi:init': { options: MochiServeOptions };
  'mochi:listening': { options: MochiServeOptions; server: Server<undefined> };
  'mochi:queuesMounted': {
    options: MochiServeOptions;
    server: Server<undefined>;
    /** Names of the queues just mounted, in declaration order. */
    queues: string[];
  };
  'mochi:ready': { options: MochiServeOptions; server: Server<undefined> };
  'mochi:shutdown': {
    options: MochiServeOptions;
    server: Server<undefined>;
    /** Absent when the shutdown came from a programmatic `Mochi.stop()` rather than SIGTERM/SIGINT. */
    signal?: NodeJS.Signals;
  };
  'route:matched': {
    pattern: string;
    request: Request;
    url: URL;
    params: Record<string, string>;
    kind: 'page' | 'api' | 'ws' | 'sse' | 'file';
  };
  'image:localAssetEmitted': {
    sourcePath: string;
    /** Where the content-hashed copy was written, under `<outDir>/assets/`. */
    diskPath: string;
    /** The same-origin URL the import resolves to (post-`image:localAssetUrl`). */
    url: string;
    width: number;
    height: number;
    format: ImportedImageFormat;
    contentType: string;
  };
}

export interface MochiHookKindMap {
  'mochi:init': 'async';
  'mochi:listening': 'async';
  'mochi:queuesMounted': 'async';
  'mochi:ready': 'async';
  'mochi:shutdown': 'async';
  'route:matched': 'sync';
  'image:localAssetEmitted': 'async';
}

type Hook<K extends keyof MochiHookContext> = MochiHookKindMap[K] extends 'async' ? (ctx: MochiHookContext[K]) => void | Promise<void> : (ctx: MochiHookContext[K]) => void;

export type MochiHooks = { [K in keyof MochiHookContext]?: Hook<K> };

export interface MochiFilterValue {
  'csrf:formContentTypes': Set<string>;
  'csrf:protectedMethods': Set<string>;
  'csrf:trustedOrigins': Set<string>;
  'csrf:check': Response | null;
  'trailingSlash:redirect': Response | null;
  'cookie:defaults': CookieSerializeOptions;
  'security:headers': Record<string, string>;
  'html:shell': string;
  'serverIsland:secretKey': Buffer;
  'serverIsland:inlineBudget': number;
  'payload:compressMinBytes': number;
  'compile:preprocessors': PreprocessorGroup[];
  'publicDir:scan': Map<string, string>;
  'consoleLogger:level': ConsoleLoggerLevel;
  'consoleLogger:line': string;
  'barrel:warn': string;
  'image:maxRedirects': number;
  'image:url': string;
  'image:fileFilter': RegExp;
  'image:localAssetFilename': string;
  'image:localAssetUrl': string;
  'email:message': ResolvedEmailMessage;
  'captcha:bits': number;
  'captcha:minAgeMs': number;
  'captcha:driftAllowanceMs': number;
  'captcha:solveBudgetMs': number;
  'queue:expireInSeconds': number;
}

// Overrides the return type where it differs from the input. Most filters are symmetric, so this map is sparse and an
// absent key defaults to `MochiFilterValue[K]`.
export interface MochiFilterReturn {
  'consoleLogger:line': string | null;
  'barrel:warn': string | null;
  'email:message': ResolvedEmailMessage | null;
}

export interface MochiFilterContext {
  'csrf:formContentTypes': { options: MochiServeOptions };
  'csrf:protectedMethods': { options: MochiServeOptions };
  'csrf:trustedOrigins': { options: MochiServeOptions };
  'csrf:check': { request: Request; url: URL };
  'trailingSlash:redirect': { request: Request; url: URL; policy: TrailingSlashPolicy };
  'cookie:defaults': { options: MochiServeOptions };
  'security:headers': { options: MochiServeOptions };
  'html:shell': { options: MochiServeOptions; development: boolean };
  'serverIsland:secretKey': { options: MochiServeOptions; envKeyPresent: boolean };
  /** Resolved per island fetch as the endpoint arms nested-island inlining; never fires when `inlineNestedIslands` is off or the fetched island also hydrates. */
  'serverIsland:inlineBudget': {
    /** Identity key of the island being fetched, e.g. `Dashboard_ab12cd34`. */
    componentName: string;
    request: Request;
  };
  'payload:compressMinBytes': { options: MochiServeOptions; payload: Uint8Array };
  'compile:preprocessors': {
    filename: string;
    target: 'server' | 'client';
    development: boolean;
  };
  'publicDir:scan': { publicDir: string; development: boolean };
  /** Resolved after the 5xx/slow escalation and before `consoleLogger:line`, so a filter can de-escalate an escalated line and `consoleLogger:line` sees the remapped level. */
  'consoleLogger:level': ConsoleLoggerLine;
  'consoleLogger:line': ConsoleLoggerLine & {
    /** Resolved log level (escalated to `'warn'` for 5xx / slow requests, then passed through `consoleLogger:level`). */
    level: ConsoleLoggerLevel;
  };
  'barrel:warn': {
    /** The offending package, e.g. `'@lucide/svelte'`. */
    pkg: string;
    /** The large re-export file pulled into the graph, relative to its package, e.g. `'@lucide/svelte/dist/icons/index.js'`. */
    file: string;
    /** Parsed size of `file` in bytes. */
    bytes: number;
    /** Fraction of `bytes` that survived into the bundle (≈ 0 for a barrel). */
    usedRatio: number;
  };
  'image:maxRedirects': { src: string };
  'image:url': { src: string; filename: string; original: boolean };
  /** Fires once per build pass (`target`), setting the `onLoad` gate for local image imports. */
  'image:fileFilter': { target: 'server' | 'client' };
  'image:localAssetFilename': { sourcePath: string; hash: string; ext: string; format: ImportedImageFormat; width: number; height: number };
  'image:localAssetUrl': { sourcePath: string; filename: string; assetPrefix: string; format: ImportedImageFormat };
  'email:message': { transport: MochiEmailTransportConfig['type'] };
  /** Resolved once at startup, as the captcha options are read. */
  'captcha:bits': {
    options: MochiCaptchaOptions;
    /** Whether the incoming value is the app's own `bits` option rather than the framework default. */
    configured: boolean;
  };
  'captcha:minAgeMs': {
    /** Difficulty sealed into this token at mint. */
    bits: number;
    /** This token's measured age. Already spent — shown so the filter can log, not so it can decide on it. */
    ageMs: number;
    /** Upper bound the returned floor must stay under, drift allowance included. */
    limitMs: number;
  };
  'captcha:driftAllowanceMs': { options: MochiCaptchaOptions; maxAgeMs: number };
  'captcha:solveBudgetMs': {
    options: MochiCaptchaOptions;
    /** Resolved difficulty, filter included — the budget has to cover the work this implies. */
    bits: number;
  };
  /** Resolved once per queue, as it is mounted. */
  'queue:expireInSeconds': {
    queue: string;
    /** Whether this queue set `expireInSeconds` itself, so the incoming value is its choice, not the framework default. */
    explicit: boolean;
  };
}

export interface MochiFilterKindMap {
  'csrf:formContentTypes': 'sync';
  'csrf:protectedMethods': 'sync';
  'csrf:trustedOrigins': 'sync';
  'csrf:check': 'sync';
  'trailingSlash:redirect': 'sync';
  'cookie:defaults': 'sync';
  'security:headers': 'sync';
  'html:shell': 'sync';
  'serverIsland:secretKey': 'async';
  'serverIsland:inlineBudget': 'sync';
  'payload:compressMinBytes': 'sync';
  'compile:preprocessors': 'sync';
  'publicDir:scan': 'async';
  'consoleLogger:level': 'sync';
  'consoleLogger:line': 'sync';
  'barrel:warn': 'sync';
  'image:maxRedirects': 'sync';
  'image:url': 'sync';
  'image:fileFilter': 'sync';
  'image:localAssetFilename': 'sync';
  'image:localAssetUrl': 'sync';
  'email:message': 'async';
  'captcha:bits': 'sync';
  'captcha:minAgeMs': 'sync';
  'captcha:driftAllowanceMs': 'sync';
  'captcha:solveBudgetMs': 'sync';
  'queue:expireInSeconds': 'sync';
}

type FilterReturn<K extends keyof MochiFilterValue> = K extends keyof MochiFilterReturn ? MochiFilterReturn[K] : MochiFilterValue[K];

type Filter<K extends keyof MochiFilterValue> = MochiFilterKindMap[K] extends 'async'
  ? (value: MochiFilterValue[K], ctx: MochiFilterContext[K]) => FilterReturn<K> | Promise<FilterReturn<K>>
  : (value: MochiFilterValue[K], ctx: MochiFilterContext[K]) => FilterReturn<K>;

export type MochiFilters = { [K in keyof MochiFilterValue]?: Filter<K> };

// These runtime kind tables mirror the TypeScript kind maps above, so a new extension point needs an entry in both: the
// type map for compile-time narrowing, the runtime table so the invoker knows whether to await. The value type widens to
// `'sync' | 'async'` to keep the comparisons below reachable when every current entry happens to share one kind.
type MochiKind = 'sync' | 'async';
const HOOK_KINDS: { [K in keyof MochiHookContext]: MochiKind } = {
  'mochi:init': 'async',
  'mochi:listening': 'async',
  'mochi:queuesMounted': 'async',
  'mochi:ready': 'async',
  'mochi:shutdown': 'async',
  'route:matched': 'sync',
  'image:localAssetEmitted': 'async',
};
const FILTER_KINDS: { [K in keyof MochiFilterValue]: MochiKind } = {
  'csrf:formContentTypes': 'sync',
  'csrf:protectedMethods': 'sync',
  'csrf:trustedOrigins': 'sync',
  'csrf:check': 'sync',
  'trailingSlash:redirect': 'sync',
  'cookie:defaults': 'sync',
  'security:headers': 'sync',
  'html:shell': 'sync',
  'serverIsland:secretKey': 'async',
  'serverIsland:inlineBudget': 'sync',
  'payload:compressMinBytes': 'sync',
  'compile:preprocessors': 'sync',
  'publicDir:scan': 'async',
  'consoleLogger:level': 'sync',
  'consoleLogger:line': 'sync',
  'barrel:warn': 'sync',
  'image:maxRedirects': 'sync',
  'image:url': 'sync',
  'image:fileFilter': 'sync',
  'image:localAssetFilename': 'sync',
  'image:localAssetUrl': 'sync',
  'email:message': 'async',
  'captcha:bits': 'sync',
  'captcha:minAgeMs': 'sync',
  'captcha:driftAllowanceMs': 'sync',
  'captcha:solveBudgetMs': 'sync',
  'queue:expireInSeconds': 'sync',
};

// Pinned on globalThis so duplicate bundled copies of mochi-framework share one registry, the same reasoning as the
// AsyncLocalStorage in `requestContext.ts`. One per process suffices, since `initMochiConfig` forbids a second `Mochi.serve()`.
const registry = pinGlobal<{ eventHooks: MochiHooks; filters: MochiFilters }>('__mochi_extensions_registry__', () => ({ eventHooks: {}, filters: {} }));

// The registry is populated on the server alone, so a client-side read would hand back the framework default and
// quietly drop whatever the app configured — see `utils/serverOnly.ts`.
const SERVER_ONLY_REASON = 'Hooks and filters are server-only — the registry only exists in the server process, so this call could never see a registered entry.';

export function initExtensions(opts: Pick<MochiServeOptions, 'eventHooks' | 'filters'>): void {
  assertServerOnly('initExtensions()', SERVER_ONLY_REASON);
  registry.eventHooks = opts.eventHooks ?? {};
  registry.filters = opts.filters ?? {};
}

// Dispatching on the runtime kind table guarantees the actual return matches the declared one — `Promise<void>` for
// async-kind names, `void` for sync-kind — including when no user fn is registered.
export function runHook<K extends keyof MochiHookContext>(name: K, ctx: MochiHookContext[K]): MochiHookKindMap[K] extends 'async' ? Promise<void> : void {
  assertServerOnly(`runHook('${name}')`, SERVER_ONLY_REASON);
  // Startup hooks double as lifecycle milestones, and recording here rather than at each call site keeps the record in
  // step with the hooks themselves. Per-request hooks like `route:matched` stay out of it.
  if (STARTUP_MILESTONE_HOOKS.has(name)) {
    markStartupMilestone(name as MochiStartupMilestone);
  }
  const fn = registry.eventHooks[name] as Hook<K> | undefined;
  if (HOOK_KINDS[name] === 'async') {
    return Promise.resolve(fn?.(ctx)) as never;
  }
  fn?.(ctx);
  return undefined as never;
}

// Returns the filtered value, or the input unchanged when no fn is registered. Async-kind filters may return a Promise,
// and the conditional return type forces the caller to await those.
export function applyFilter<K extends keyof MochiFilterValue>(
  name: K,
  value: MochiFilterValue[K],
  ctx: MochiFilterContext[K],
): MochiFilterKindMap[K] extends 'async' ? FilterReturn<K> | Promise<FilterReturn<K>> : FilterReturn<K> {
  assertServerOnly(`applyFilter('${name}')`, SERVER_ONLY_REASON);
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
