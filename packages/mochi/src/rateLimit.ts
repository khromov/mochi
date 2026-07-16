import { checkLimit, memoryStore, DEFAULT_LIMIT, DEFAULT_WINDOW, DEFAULT_MESSAGE } from '@joint-ops/hitlimit-bun';
import type { HitLimitInfo, HitLimitOptions, HitLimitResult, HitLimitStore, ResolvedConfig } from '@joint-ops/hitlimit-bun';
import { sqliteStore as hitlimitSqliteStore } from '@joint-ops/hitlimit-bun/stores/sqlite';
import type { SqliteStoreOptions } from '@joint-ops/hitlimit-bun/stores/sqlite';
import { logger } from './log';
import { getRequestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';

export { memoryStore };
export { postgresStore } from '@joint-ops/hitlimit-bun/stores/postgres';

/**
 * hitlimit v1.5.0 keeps its prepared statements on the store and never finalizes
 * them, so its `shutdown()` reaches `db.close()` — the no-arg form, i.e.
 * `sqlite3_close_v2` — with statements still outstanding. That only zombies the
 * connection: the db/-wal/-shm files stay open until GC finalizes the statements,
 * and Windows refuses to unlink an open file. Finalize them first so the close
 * actually releases the handles. The dep is pinned; re-verify on bumps.
 */
export function sqliteStore(options?: SqliteStoreOptions): HitLimitStore {
  const store = hitlimitSqliteStore(options);
  const close = store.shutdown?.bind(store);
  store.shutdown = () => {
    for (const value of Object.values(store)) {
      (value as { finalize?: () => void } | null)?.finalize?.();
    }
    close?.();
  };
  return store;
}

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

/**
 * Per-route / global rate-limit options — a mirror of hitlimit's `HitLimitOptions`
 * minus `logger` (Mochi has its own logging) and the deprecated `sqlitePath`. The
 * `key` / `tier` / `skip` / `group` callbacks additionally receive Mochi's request
 * context as a second argument (see `MochiRateLimitContext`).
 */
export type MochiRateLimitOptions = Pick<HitLimitOptions<Request>, 'limit' | 'window' | 'tiers' | 'response' | 'headers' | 'store' | 'onStoreError' | 'ban'> & {
  key?: MochiRateLimitKey;
  tier?: MochiRateLimitTier;
  skip?: MochiRateLimitSkip;
  group?: string | MochiRateLimitGroup;
};

export type RouteLimitOutcome =
  | { kind: 'skip' }
  | { kind: 'allowed'; info: HitLimitInfo; headers: Record<string, string> }
  | {
      kind: 'blocked';
      info: HitLimitInfo | null;
      headers: Record<string, string>;
      body: Record<string, unknown>;
      retryAfterSeconds: number | null;
    };

export interface RouteLimiter {
  check(req: Request, getClientAddress: () => string | null): Promise<RouteLimitOutcome>;
  reset(key: string): void | Promise<void>;
  store: HitLimitStore;
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

export function createRouteLimiter(options: MochiRateLimitOptions): RouteLimiter {
  const store = options.store ?? memoryStore();
  const userKey = options.key;
  const userTier = options.tier;
  const userSkip = options.skip;
  const userGroup = options.group;
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
    group: typeof userGroup === 'function' ? (req) => userGroup(req, getRequestContext()) : (userGroup ?? null),
  };
  return {
    store,
    ownsStore: !options.store,
    reset: (key) => store.reset(key),
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
