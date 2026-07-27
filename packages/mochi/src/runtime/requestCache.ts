import { requestContext } from './requestContext';
import { getMochiConfig } from '../mochiConfig';
import { logger } from '../utils/log';
import { pinGlobal } from '../utils/globalState';

/**
 * Request-scoped memo store whose entries live and die with the HTTP request, so N callers within one render collapse to
 * one execution while an invalidation between requests is always seen. It sits below `MochiCache`: the request boundary
 * is the TTL, so there are no storage backends, serialization, or eviction.
 */
export interface MochiRequestCache {
  get<T = unknown>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  /** Return the cached value for `key`, or run `fn`, store, and return its result. */
  getOrSet<T>(key: string, fn: () => T): T;
  /** Number of entries currently stored. */
  readonly size: number;
  /** Hit/miss counters for this request, surfaced in the dev debug bar. */
  stats(): { hits: number; misses: number };
}

export interface RequestCacheState {
  map: Map<string, unknown>;
  hits: number;
  misses: number;
  /** Per-key hit/miss tallies, in first-touch order, surfaced in the dev debug bar. */
  perKey: Map<string, { hits: number; misses: number }>;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

let warnedNoContext = false;

function warnNoContext(label: string): void {
  if (warnedNoContext) {
    return;
  }
  // A missing config means we're outside a served request entirely (a script, a
  // test); treat that as development so the hint isn't swallowed.
  let development = true;
  try {
    development = getMochiConfig().options.development ?? true;
  } catch {
    // No server configured yet — keep the default.
  }
  if (!development) {
    return;
  }
  warnedNoContext = true;
  logger.warn(`${label} was called outside of a request; the result is not cached. ` + 'Request-cached helpers only memoize inside a Mochi request handler.');
}

// The single funnel every entry point goes through, so counters and
// rejection-eviction behave identically for `requestCache`, `getOrSet` and
// `requestMemo`.
function bumpKey(state: RequestCacheState, key: string, kind: 'hits' | 'misses'): void {
  let tally = state.perKey.get(key);
  if (!tally) {
    tally = { hits: 0, misses: 0 };
    state.perKey.set(key, tally);
  }
  tally[kind]++;
}

function getOrSetIn<T>(state: RequestCacheState, key: string, fn: () => T): T {
  if (state.map.has(key)) {
    state.hits++;
    bumpKey(state, key, 'hits');
    return state.map.get(key) as T;
  }
  state.misses++;
  bumpKey(state, key, 'misses');
  const value = fn();
  state.map.set(key, value);
  if (isThenable(value)) {
    // Evict on rejection so a failed pass is never cached. The original promise
    // is what's returned and stored — the `then` product is discarded, so no
    // extra unhandled-rejection edge is created and callers still see the throw.
    void Promise.resolve(value).then(undefined, () => {
      if (state.map.get(key) === value) {
        state.map.delete(key);
      }
    });
  }
  return value;
}

function currentState(): RequestCacheState | undefined {
  const ctx = requestContext.getStore();
  if (!ctx) {
    return undefined;
  }
  return (ctx.requestCache ??= { map: new Map(), hits: 0, misses: 0, perKey: new Map() });
}

// Detached store handed out by `getRequestCache()` when there is no request:
// writes go nowhere shared, reads always miss, so callers can use the same API
// unconditionally without branching.
function detachedState(): RequestCacheState {
  return { map: new Map(), hits: 0, misses: 0, perKey: new Map() };
}

function wrap(state: RequestCacheState): MochiRequestCache {
  return {
    get: <T>(key: string) => state.map.get(key) as T | undefined,
    set: (key, value) => void state.map.set(key, value),
    has: (key) => state.map.has(key),
    delete: (key) => state.map.delete(key),
    clear: () => state.map.clear(),
    getOrSet: (key, fn) => getOrSetIn(state, key, fn),
    get size() {
      return state.map.size;
    },
    stats: () => ({ hits: state.hits, misses: state.misses }),
  };
}

/**
 * The current request's cache. Outside a request it returns a throwaway store plus a one-time development warning, so
 * calling code never has to branch.
 *
 * ```ts
 * const cache = getRequestCache();
 * cache.set('user', user);
 * ```
 */
export function getRequestCache(): MochiRequestCache {
  const state = currentState();
  if (!state) {
    warnNoContext('getRequestCache()');
    return wrap(detachedState());
  }
  return wrap(state);
}

/**
 * Return the value cached under `key` for this request, or run `fn`, cache, and return its result. It's
 * async-transparent: the in-flight promise is stored on the first call so concurrent callers share one execution, and a
 * rejected promise evicts its entry so failures stay uncached. Outside a request `fn` runs uncached.
 *
 * ```ts
 * const user = await requestCache(`user:${id}`, () => db.user(id));
 * ```
 */
export function requestCache<T>(key: string, fn: () => T): T {
  return cacheWith(key, fn, 'requestCache()');
}

// Shared by the public entry points so each can name itself in the warning; an
// absent label suppresses it.
function cacheWith<T>(key: string, fn: () => T, label: string | undefined): T {
  const state = currentState();
  if (!state) {
    if (label) {
      warnNoContext(label);
    }
    return fn();
  }
  return getOrSetIn(state, key, fn);
}

export interface RequestMemoOptions<A extends unknown[]> {
  /** Build the cache key from the call arguments. Required for arguments the default keying can't serialize. */
  key?: (...args: A) => string;
  /** Key prefix isolating this wrapper from every other one. Defaults to a per-wrapper unique id. */
  namespace?: string;
  /** Suppress the out-of-request development warning, for framework helpers legitimately called outside a request (background warms, detached renders). */
  quiet?: boolean;
}

// Duplicate bundled copies of this module share one backing request-cache Map through the global-pinned context, so
// their default namespaces need one counter too; a bare module-level `let` would let two copies both mint `memo:1`.
const memoCounter = pinGlobal('__mochi_request_memo_counter__', () => ({ n: 0 }));

/**
 * Wrap a function so every call within one request is memoized by its arguments, with `requestCache`'s semantics:
 * shared in-flight promises, rejections evicted, uncached outside a request.
 *
 * ```ts
 * const getUser = requestMemo((id: string) => db.user(id));
 * await getUser('42'); // one query per request, however many callers
 * ```
 */
export function requestMemo<A extends unknown[], R>(fn: (...args: A) => R, options: RequestMemoOptions<A> = {}): (...args: A) => R {
  const namespace = options.namespace ?? `memo:${++memoCounter.n}`;
  const keyOf = options.key ?? defaultKey;
  const label = options.quiet ? undefined : `${fn.name || 'A request-memoized function'}()`;
  return (...args: A): R => cacheWith(`${namespace}:${keyOf(...args)}`, () => fn(...args), label);
}

// Type-tagged so `1` and `'1'` stay distinct, as do an absent argument and an explicit `undefined` at another position.
function defaultKey(...args: unknown[]): string {
  return args.map(keyPart).join('\0');
}

function keyPart(arg: unknown): string {
  switch (typeof arg) {
    case 'string':
      return `s:${arg}`;
    case 'number':
      return `n:${arg}`;
    case 'boolean':
      return `b:${arg}`;
    case 'bigint':
      return `i:${arg}`;
    case 'undefined':
      return 'u';
    case 'object':
      if (arg === null) {
        return 'null';
      }
      try {
        return `o:${JSON.stringify(arg)}`;
      } catch {
        throw new Error('requestMemo() could not serialize an argument for the cache key. Pass a `key` function to build the key yourself.');
      }
    default:
      throw new Error(`requestMemo() cannot key a ${typeof arg} argument. Pass a \`key\` function to build the key yourself.`);
  }
}
