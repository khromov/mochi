import { checkLimit, memoryStore, DEFAULT_LIMIT, DEFAULT_WINDOW, DEFAULT_MESSAGE } from '@joint-ops/hitlimit-bun';
import type { HitLimitInfo, HitLimitOptions, HitLimitResult, HitLimitStore, ResolvedConfig } from '@joint-ops/hitlimit-bun';
import { sqliteStore as hitlimitSqliteStore } from '@joint-ops/hitlimit-bun/stores/sqlite';
import type { SqliteStoreOptions } from '@joint-ops/hitlimit-bun/stores/sqlite';
import { logger } from './log';

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
 * Per-route / global rate-limit options — a mirror of hitlimit's `HitLimitOptions`
 * minus `logger` (Mochi has its own logging) and the deprecated `sqlitePath`.
 */
export type MochiRateLimitOptions = Pick<
  HitLimitOptions<Request>,
  'limit' | 'window' | 'key' | 'tiers' | 'tier' | 'response' | 'headers' | 'store' | 'onStoreError' | 'skip' | 'ban' | 'group'
>;

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
  // hitlimit's KeyGenerator only receives the Request, but the default key must be
  // Mochi's proxy-aware client address (resolved by the caller with the server in
  // hand) — so check() stashes it per-Request and the generator reads it back.
  const addressKeys = new WeakMap<Request, string>();
  const resolved: ResolvedConfig<Request> = {
    limit: options.limit ?? DEFAULT_LIMIT,
    windowMs: parseWindow(options.window ?? DEFAULT_WINDOW),
    key: userKey ?? ((req) => addressKeys.get(req) ?? 'unknown'),
    tiers: options.tiers,
    tier: options.tier,
    response: options.response ?? { hitlimit: true, message: DEFAULT_MESSAGE },
    headers: {
      standard: options.headers?.standard ?? true,
      legacy: options.headers?.legacy ?? true,
      retryAfter: options.headers?.retryAfter ?? true,
    },
    store,
    onStoreError: options.onStoreError ?? (() => 'allow'),
    skip: options.skip,
    ban: options.ban ? { threshold: options.ban.threshold, durationMs: parseWindow(options.ban.duration) } : null,
    group: options.group ?? null,
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
