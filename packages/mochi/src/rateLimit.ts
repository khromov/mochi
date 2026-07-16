import { checkLimit, memoryStore as hitlimitMemoryStore, DEFAULT_LIMIT, DEFAULT_WINDOW, DEFAULT_MESSAGE } from '@joint-ops/hitlimit-bun';
import type { HitLimitResult, ResolvedConfig } from '@joint-ops/hitlimit-bun';
import { sqliteStore as hitlimitSqliteStore } from '@joint-ops/hitlimit-bun/stores/sqlite';
import { postgresStore as hitlimitPostgresStore } from '@joint-ops/hitlimit-bun/stores/postgres';
import type { SQL } from 'bun';
import { logger } from './log';
import { getRequestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';

/**
 * Mochi's request context, passed as the second argument to a rate-limit
 * `key` / `tier` / `skip` / `group` callback — the same object `getRequestContext()`
 * returns. Populated at limiter time: `getClientAddress()` (proxy-aware IP),
 * `cookies`, `params`, `url`, `request`. Note `locals` reflects only what ran
 * *before* the limiter — `handle` middleware runs after it, so derive identity
 * from the request (a session cookie / header) rather than a middleware-set local.
 */
export type MochiRateLimitContext = MochiRequestContext;

export type MochiRateLimitKey = (req: Request, ctx: MochiRateLimitContext) => string | Promise<string>;
export type MochiRateLimitTier = (req: Request, ctx: MochiRateLimitContext) => string | Promise<string>;
export type MochiRateLimitSkip = (req: Request, ctx: MochiRateLimitContext) => boolean | Promise<boolean>;
export type MochiRateLimitGroup = (req: Request, ctx: MochiRateLimitContext) => string | Promise<string>;

// The types below mirror @joint-ops/hitlimit-bun's shapes but are owned by Mochi:
// the public API never references hitlimit types directly, so the backing library
// can be swapped without breaking consumers. Structural typing keeps them
// interchangeable at the shim boundary.

/** Limiter state for one request: quota, usage, and reset timing. */
export interface MochiRateLimitInfo {
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  resetIn: number;
  /** Millisecond timestamp when the window resets. */
  resetAt: number;
  key: string;
  tier?: string;
  banned?: boolean;
  banExpiresAt?: number;
  violations?: number;
  group?: string;
}

export interface MochiRateLimitStoreResult {
  count: number;
  resetAt: number;
}

export interface MochiRateLimitStoreBanResult extends MochiRateLimitStoreResult {
  banned: boolean;
  violations: number;
  banExpiresAt: number;
}

/** A counter backend for rate limiting. Implement this to bring your own storage. */
export interface MochiRateLimitStore {
  /** If true, hit() is guaranteed to return synchronously (not a Promise). */
  isSync?: boolean;
  hit(key: string, windowMs: number, limit: number): Promise<MochiRateLimitStoreResult> | MochiRateLimitStoreResult;
  reset(key: string): Promise<void> | void;
  shutdown?(): Promise<void> | void;
  isBanned?(key: string): Promise<boolean> | boolean;
  ban?(key: string, durationMs: number): Promise<void> | void;
  recordViolation?(key: string, windowMs: number): Promise<number> | number;
  /** Atomic hit + ban check in one round-trip, when the backend supports it. */
  hitWithBan?(key: string, windowMs: number, limit: number, banThreshold: number, banDurationMs: number): Promise<MochiRateLimitStoreBanResult>;
}

export interface MochiRateLimitTierConfig {
  limit: number;
  window?: string | number;
}

export interface MochiRateLimitHeadersConfig {
  standard?: boolean;
  legacy?: boolean;
  retryAfter?: boolean;
}

export interface MochiRateLimitBanConfig {
  /** Number of rate-limit violations before triggering a ban. */
  threshold: number;
  /** How long the ban lasts — `'1h'`, `'30m'`, or milliseconds. */
  duration: string | number;
}

export type MochiRateLimitStoreErrorHandler = (error: Error, req: Request) => 'allow' | 'deny' | Promise<'allow' | 'deny'>;
export type MochiRateLimitResponseFormatter = (info: MochiRateLimitInfo) => Record<string, unknown>;

/**
 * Per-route / global rate-limit options — a mirror of hitlimit's `HitLimitOptions`
 * minus `logger` (Mochi has its own logging) and the deprecated `sqlitePath`. The
 * `key` / `tier` / `skip` / `group` callbacks additionally receive Mochi's request
 * context as a second argument (see `MochiRateLimitContext`).
 */
export interface MochiRateLimitOptions {
  limit?: number;
  window?: string | number;
  key?: MochiRateLimitKey;
  tiers?: Record<string, MochiRateLimitTierConfig>;
  tier?: MochiRateLimitTier;
  response?: Record<string, unknown> | MochiRateLimitResponseFormatter;
  headers?: MochiRateLimitHeadersConfig;
  store?: MochiRateLimitStore;
  onStoreError?: MochiRateLimitStoreErrorHandler;
  skip?: MochiRateLimitSkip;
  ban?: MochiRateLimitBanConfig;
  group?: string | MochiRateLimitGroup;
}

export interface MochiSqliteStoreOptions {
  /** Database file path. Omit for an in-memory database. */
  path?: string;
}

export interface MochiPostgresStoreOptions {
  /** Connection string. The store creates and owns a Bun `SQL` client. */
  url?: string;
  /** Caller-owned Bun `SQL` client. The store uses it but never closes it. */
  client?: SQL;
  tablePrefix?: string;
  cleanupInterval?: number;
  skipTableCreation?: boolean;
}

export function memoryStore(): MochiRateLimitStore {
  return hitlimitMemoryStore();
}

export function postgresStore(options: MochiPostgresStoreOptions): MochiRateLimitStore {
  return hitlimitPostgresStore(options);
}

/**
 * hitlimit v1.5.0 keeps its prepared statements on the store and never finalizes
 * them, so its `shutdown()` reaches `db.close()` — the no-arg form, i.e.
 * `sqlite3_close_v2` — with statements still outstanding. That only zombies the
 * connection: the db/-wal/-shm files stay open until GC finalizes the statements,
 * and Windows refuses to unlink an open file. Finalize them first so the close
 * actually releases the handles.
 *
 * The finalize sweep and the `db` access depend on hitlimit's private field
 * layout (the dep is pinned). `db.close(true)` is the guard: it throws
 * "database is locked" if any statement is still outstanding — so a hitlimit bump
 * that moves statements off own-enumerable fields fails loudly on every platform
 * (covered by rateLimit.test.ts), not as a silent Windows-only unlink failure.
 */
export function sqliteStore(options?: MochiSqliteStoreOptions): MochiRateLimitStore {
  const store = hitlimitSqliteStore(options);
  const close = store.shutdown?.bind(store);
  store.shutdown = () => {
    for (const value of Object.values(store)) {
      (value as { finalize?: () => void } | null)?.finalize?.();
    }
    const db = (store as unknown as { db?: { close(throwOnError?: boolean): void } }).db;
    if (!db) {
      throw new Error('hitlimit sqlite store layout changed (no `db` field) — update the shutdown shim in rateLimit.ts');
    }
    db.close(true);
    // Upstream shutdown still owns the cleanup timer; its own db.close() is now a
    // no-op. This whole block is synchronous, so the timer can't fire in between.
    close?.();
  };
  return store;
}

export type RouteLimitOutcome =
  | { kind: 'skip' }
  | { kind: 'allowed'; info: MochiRateLimitInfo; headers: Record<string, string> }
  | {
      kind: 'blocked';
      info: MochiRateLimitInfo | null;
      headers: Record<string, string>;
      body: Record<string, unknown>;
      retryAfterSeconds: number | null;
    };

export interface RouteLimiter {
  check(req: Request, getClientAddress: () => string | null): Promise<RouteLimitOutcome>;
  reset(key: string): void | Promise<void>;
  store: MochiRateLimitStore;
  /** True when the limiter created its own store (no `store` option) — only those are shut down by the framework. */
  ownsStore: boolean;
}

// Replica of hitlimit-bun's unexported parseWindow/resolveConfig (dist/index.js,
// v1.5.0 — the dep is pinned; re-verify on bumps). checkLimit() requires a fully
// resolved config, and only the low-level checkLimit exposes info/headers for
// allowed requests (needed for success headers + ctx.rateLimit).
const WINDOW_UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseWindow(window: string | number): number {
  if (typeof window === 'number') {
    return window;
  }
  const match = window.match(/^(\d+)(s|m|h|d)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid window format: ${window}`);
  }
  return parseInt(match[1]) * WINDOW_UNITS[match[2]]!;
}

/**
 * `autoGroup` namespaces this limiter's stored keys behind a `group:<autoGroup>:`
 * prefix (see hitlimit's `resolveKey`) so counters can't collide with another
 * route sharing the same persisted store. Mochi passes the route pattern for a
 * route's *own* `rateLimit` config; the shared global limiter passes nothing, so
 * routes inheriting it keep sharing one bucket. An explicit `group` always wins —
 * set it to opt back into cross-route sharing.
 */
export function createRouteLimiter(options: MochiRateLimitOptions, autoGroup?: string): RouteLimiter {
  const store = options.store ?? memoryStore();
  const userKey = options.key;
  const userTier = options.tier;
  const userSkip = options.skip;
  const userGroup = options.group;
  // The group that namespaces stored keys, when it's knowable without a request.
  const staticGroup = typeof userGroup === 'function' ? null : (userGroup ?? autoGroup ?? null);
  // hitlimit's KeyGenerator only receives the Request, but Mochi's callbacks take a
  // second argument — the request context. The limiter always runs inside
  // `requestContext.run()` (see checkRouteLimit in Mochi.ts), so the wrappers read
  // the ambient context with getRequestContext() and forward it. The default key
  // instead needs Mochi's proxy-aware client address, which the caller resolves with
  // the server in hand; check() stashes it per-Request and the generator reads it back.
  const addressKeys = new WeakMap<Request, string>();
  const resolved: ResolvedConfig<Request> = {
    limit: options.limit ?? DEFAULT_LIMIT,
    windowMs: parseWindow(options.window ?? DEFAULT_WINDOW),
    key: userKey ? (req) => userKey(req, getRequestContext()) : (req) => addressKeys.get(req) ?? 'unknown',
    tiers: options.tiers,
    tier: userTier ? (req) => userTier(req, getRequestContext()) : undefined,
    response: options.response ?? { hitlimit: true, message: DEFAULT_MESSAGE },
    headers: {
      standard: options.headers?.standard ?? true,
      legacy: options.headers?.legacy ?? true,
      retryAfter: options.headers?.retryAfter ?? true,
    },
    store,
    onStoreError: options.onStoreError ?? (() => 'allow'),
    skip: userSkip ? (req) => userSkip(req, getRequestContext()) : undefined,
    ban: options.ban ? { threshold: options.ban.threshold, durationMs: parseWindow(options.ban.duration) } : null,
    group: typeof userGroup === 'function' ? (req) => userGroup(req, getRequestContext()) : staticGroup,
  };
  return {
    store,
    ownsStore: !options.store,
    // Stored keys are namespaced `group:<id>:<key>` when a group applies (see
    // hitlimit's resolveKey), so reset must target the qualified key. With a
    // dynamic `group` callback the namespace is per-request and unknowable here —
    // callers must pass the fully qualified stored key themselves.
    reset: (key) => store.reset(staticGroup === null ? key : `group:${staticGroup}:${key}`),
    async check(req, getClientAddress) {
      // checkLimit() doesn't apply skip/onStoreError — those live in hitlimit's
      // wrappers, so the shim replicates their semantics (skip → bypass; store
      // error → 'allow' bypasses, 'deny' blocks without limit info).
      if (resolved.skip && (await resolved.skip(req))) {
        return { kind: 'skip' };
      }
      if (!userKey) {
        addressKeys.set(req, getClientAddress() ?? 'unknown');
      }
      let result: HitLimitResult;
      try {
        result = await checkLimit(resolved, req);
      } catch (error) {
        const action = await resolved.onStoreError(error as Error, req);
        // A dead store must not fail silently — fail-open means rate limiting
        // is effectively off until the store recovers.
        logger.warn(
          `Rate limit store error (${action === 'deny' ? 'failing closed, blocking request' : 'failing open, request allowed'}): ${error instanceof Error ? error.message : String(error)}`,
        );
        return action === 'deny'
          ? { kind: 'blocked', info: null, headers: {}, body: { hitlimit: true, message: 'Rate limiting unavailable' }, retryAfterSeconds: null }
          : { kind: 'skip' };
      }
      return result.allowed
        ? { kind: 'allowed', info: result.info, headers: result.headers }
        : { kind: 'blocked', info: result.info, headers: result.headers, body: result.body, retryAfterSeconds: result.info.resetIn };
    },
  };
}

export function applyRateLimitHeaders(response: Response, headers: Record<string, string>): Response {
  try {
    for (const [name, value] of Object.entries(headers)) {
      response.headers.set(name, value);
    }
    return response;
  } catch {
    // Responses proxied from fetch() have immutable headers — re-wrap.
    const merged = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) {
      merged.set(name, value);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
  }
}
