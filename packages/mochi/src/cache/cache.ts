import { randomUUID } from 'node:crypto';
import { MemoryStorage } from './cache-storage';
import { mochiEvents } from '../events';

export type CacheStatus = 'fresh' | 'stale' | 'expired' | 'miss';

export interface SweepOptions {
  /** Also return the plaintext keys removed by this sweep. Default `false`. */
  reportKeys?: boolean;
}

export interface SweepResult {
  /** Entries removed by this sweep. */
  removed: number;
  /** The removed keys, when `reportKeys` was requested and the backend supports it. May be shorter than `removed`, since `FileStorage` counts `.tmp` writes and corrupt files it cannot name. */
  removedKeys?: string[];
}

/**
 * Pluggable key/value backend, defaulting to an in-memory Map. The cache awaits every call, so methods may be
 * synchronous (`Map`, `bun:sqlite`) or return a `Promise` (Redis, network-backed stores).
 */
export interface Storage {
  getItem(key: string): unknown | Promise<unknown>;
  setItem(key: string, value: unknown): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  /** Remove every entry from the backend. */
  clear(): void | Promise<void>;
  /**
   * Optional age-based eviction, driven on demand by a caller's janitor (e.g. `ImageCache`) and implemented by both
   * `FileStorage` and `MemoryStorage`. `reportKeys` additionally returns the plaintext keys removed, letting a janitor
   * attribute removals without re-enumerating the backend; it's opt-in because it costs extra work — `FileStorage` reads
   * each expired entry's envelope before unlinking.
   */
  sweep?(now?: number, options?: SweepOptions): SweepResult | Promise<SweepResult>;
  /** Optional entry count, for observability (e.g. the dev debug bar). `FileStorage` and `MemoryStorage` both implement it. */
  count?(): number | Promise<number>;
  /** Optional list of all stored keys, for observability (e.g. the dev debug bar). `FileStorage` and `MemoryStorage` both implement it. */
  keys?(): string[] | Promise<string[]>;
}

export interface MochiCacheOptions {
  /** Age (ms) after which a cached value is served stale and revalidated in the background. */
  minTimeToStale?: number;
  /** Age (ms) after which a cached value is discarded and recomputed synchronously. */
  maxTimeToLive?: number;
  /** Custom storage backend. Defaults to in-memory Map-based storage. */
  storage?: Storage;
  /** Serialize a cache entry before it is written to storage. Defaults to identity. */
  serialize?: (entry: unknown) => unknown;
  /** Deserialize a cache entry read back from storage. Defaults to identity. */
  deserialize?: (raw: unknown) => unknown;
  /**
   * Max ms a single recompute may hold the per-key in-flight lock; past it the lock releases and coalesced callers reject
   * with a timeout error, so a hung upstream can't trap every waiter. The abandoned run keeps executing, and the
   * stored-write guard discards its result. Default 1 hour; `<= 0` or non-finite disables the timeout.
   */
  inflightTimeout?: number;
  /**
   * Best-effort cross-process request coalescing over a shared `storage` backend: a recompute writes an advisory
   * `mochi:inflight:<key>` marker, and a peer hitting a stale entry while that marker is fresh serves its in-hand value
   * instead of piling on a duplicate regeneration. The marker is advisory rather than an atomic lock and leases to
   * `inflightTimeout`, so a crashed peer's marker self-expires. Meant for a shared `FileStorage`. Default false.
   */
  crossProcessInflight?: boolean;
}

export interface CacheResult<T> {
  value: T;
  status: CacheStatus;
}

/** What we persist per key: the value plus the time it was written. */
interface CacheEntry {
  value: unknown;
  createdAt: number;
}

const identity = (value: unknown) => value;

// Racing against a timeout keeps a hung `fn` from holding the per-key in-flight lock forever. `Promise.race` attaches a
// reaction to `work`, so a rejection arriving after the timeout wins still counts as handled and `run`'s stored-write
// guard discards its result.
function withTimeout<T>(work: Promise<T>, ms: number, key: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`MochiCache: recompute for "${key}" timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export class MochiCache {
  private storage: Storage;
  private minTimeToStale: number;
  private maxTimeToLive: number;
  private serialize: (entry: unknown) => unknown;
  private deserialize: (raw: unknown) => unknown;
  private inflightTimeout: number;
  private crossProcessInflight: boolean;
  private inflight = new Map<string, Promise<unknown>>();

  constructor(options: MochiCacheOptions = {}) {
    this.storage = options.storage ?? new MemoryStorage();
    this.minTimeToStale = options.minTimeToStale ?? 5_000;
    this.maxTimeToLive = options.maxTimeToLive ?? 600_000;
    this.serialize = options.serialize ?? identity;
    this.deserialize = options.deserialize ?? identity;
    this.inflightTimeout = options.inflightTimeout ?? 3_600_000;
    this.crossProcessInflight = options.crossProcessInflight ?? false;

    if (this.minTimeToStale >= this.maxTimeToLive) {
      throw new Error(`MochiCache: minTimeToStale (${this.minTimeToStale}) must be less than maxTimeToLive (${this.maxTimeToLive}).`);
    }
  }

  async fetch<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const result = await this.fetchWithStatus(key, fn);
    return result.value;
  }

  async fetchWithStatus<T>(key: string, fn: () => T | Promise<T>): Promise<CacheResult<T>> {
    const entry = await this.read(key);

    if (entry == null) {
      const value = await this.run(key, fn);
      return this.emitRead(key, value, 'miss');
    }

    const cached = entry.value as T;
    const age = this.now() - entry.createdAt;

    if (age < this.minTimeToStale) {
      return this.emitRead(key, cached, 'fresh');
    }

    if (age < this.maxTimeToLive) {
      // A peer process is already refreshing this key — serve our in-hand value
      // and don't add a duplicate background regen to the fleet.
      if (await this.deferToPeer(key)) {
        return this.emitRead(key, cached, 'stale');
      }
      // Serving stale while refreshing in the background would hide a failing upstream until `maxTimeToLive`, so the
      // event surfaces the degradation to logging and metrics.
      mochiEvents.emit('cache:revalidate', { key });
      void this.run(key, fn).catch((error) => {
        mochiEvents.emit('cache:revalidate:failed', { key, error });
      });
      return this.emitRead(key, cached, 'stale');
    }

    // Past `maxTimeToLive`, a fresh peer marker within the grace window still serves the old value instead of piling on
    // a duplicate synchronous regen; past the bound it recomputes regardless, so a wedged fleet can't serve
    // arbitrarily ancient bytes.
    if (age < this.maxTimeToLive + this.inflightTimeout && (await this.deferToPeer(key))) {
      return this.emitRead(key, cached, 'stale');
    }

    const value = await this.run(key, fn);
    return this.emitRead(key, value, 'expired');
  }

  async delete(key: string): Promise<void> {
    this.inflight.delete(key);
    try {
      await this.storage.removeItem(key);
    } catch (error) {
      mochiEvents.emit('cache:error', { key, operation: 'remove', error });
      throw error;
    }
    // Dropping the advisory marker keeps a just-invalidated key from making peers defer to a regeneration that will no longer happen.
    await this.removeMarker(key);
    mochiEvents.emit('cache:delete', { key });
  }

  /**
   * A pure probe of a key's current status and value, returning `null` on a miss. It leaves `fn` unrun and emits no
   * `cache:read`, reporting `'expired'` for an entry past `maxTimeToLive` where `fetchWithStatus` would refresh it.
   */
  async peek<T>(key: string): Promise<CacheResult<T> | null> {
    const entry = await this.read(key);
    if (entry == null) {
      return null;
    }
    const age = this.now() - entry.createdAt;
    const status: CacheStatus = age < this.minTimeToStale ? 'fresh' : age < this.maxTimeToLive ? 'stale' : 'expired';
    return { value: entry.value as T, status };
  }

  /**
   * Write `value` to `key` unconditionally, stamped fresh — the counterpart to `fetch`, which computes only on a
   * miss or stale read and so can't replace a still-present entry.
   *
   * Prefer this to `delete` + `fetch`, which leaves the key absent for the whole write while concurrent readers see a
   * miss and each start their own recompute; on `FileStorage` this is a single atomic replace, so a reader sees the old
   * value or the new one.
   *
   * It drops the key's in-flight run, so a recompute already underway settles without writing. As with `delete` and
   * `markStale`, that reaches only a run that has registered: a `fetch` still awaiting its initial storage read hasn't
   * claimed the slot, and its write lands after this one.
   */
  async set<T>(key: string, value: T): Promise<void> {
    this.inflight.delete(key);
    const entry = this.serialize({ value, createdAt: this.now() } satisfies CacheEntry);
    try {
      await this.storage.setItem(key, entry);
    } catch (error) {
      mochiEvents.emit('cache:error', { key, operation: 'set', error });
      throw error;
    }
  }

  /**
   * Backdate a key so its next read is served stale-while-revalidate, rewriting the stored entry's `createdAt` to
   * `now - minTimeToStale` so its age lands in `[minTimeToStale, maxTimeToLive)`. A no-op for a missing key or one
   * already at-or-past that age, so an entry can only move staler. Runs through the `Storage` interface, covering both backends.
   */
  async markStale(key: string): Promise<void> {
    // Drop any in-flight run first so its supersession guard trips and a pending
    // revalidation can't overwrite the backdated timestamp.
    this.inflight.delete(key);
    let raw: unknown;
    try {
      raw = await this.storage.getItem(key);
    } catch (error) {
      mochiEvents.emit('cache:error', { key, operation: 'get', error });
      return;
    }
    if (raw == null) {
      return;
    }
    const entry = this.deserialize(raw) as CacheEntry;
    const staleCreatedAt = this.now() - this.minTimeToStale;
    if (entry.createdAt <= staleCreatedAt) {
      return;
    }
    const next = this.serialize({ value: entry.value, createdAt: staleCreatedAt } satisfies CacheEntry);
    try {
      await this.storage.setItem(key, next);
    } catch (error) {
      mochiEvents.emit('cache:error', { key, operation: 'set', error });
    }
  }

  /**
   * Resolves once every compute this cache is currently running has settled, including the fire-and-forget background
   * revalidations a stale read starts. A run is tracked from before its `fn` is invoked until after its storage write,
   * so an awaited `whenIdle()` guarantees the refreshed value is readable — unlike waiting on `cache:revalidate`, which
   * only marks the start.
   *
   * Each pass also picks up work a settling run started, so this drains a chain of revalidations rather than one level.
   * It waits for whatever is in flight: under continuous writes it keeps waiting, so treat it as a shutdown/quiescence
   * primitive rather than something to await on a hot request path. A failed run settles it like any other.
   */
  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled(this.inflight.values());
    }
  }

  async clearItems(): Promise<void> {
    // Drop in-flight runs first so a pending revalidation can't repopulate a key
    // after the storage is cleared.
    this.inflight.clear();
    try {
      await this.storage.clear();
    } catch (error) {
      mochiEvents.emit('cache:error', { key: '*', operation: 'clear', error });
      throw error;
    }
  }

  // Read and deserialize a cache entry. A storage read failure degrades to a
  // miss (recompute) rather than propagating to the request as a 500.
  private async read(key: string): Promise<CacheEntry | null> {
    let raw: unknown;
    try {
      raw = await this.storage.getItem(key);
    } catch (error) {
      mochiEvents.emit('cache:error', { key, operation: 'get', error });
      return null;
    }
    return raw == null ? null : (this.deserialize(raw) as CacheEntry);
  }

  // Run `fn` once per key even under concurrent callers, then persist the result.
  private run<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const ref: { current: Promise<T> | null } = { current: null };
    // Owns this run's advisory marker: a timed-out/superseded run that settles
    // late must not delete the marker a newer run has since written.
    const runId = randomUUID();
    const work = (async () => {
      // Published before the expensive `fn` so a peer starting moments later sees it and defers, and removed once this run settles.
      await this.writeMarker(key, runId);
      try {
        const value = await fn();
        const serialized = this.serialize({ value, createdAt: this.now() } satisfies CacheEntry);
        // A run superseded while `fn` was pending — by an inflight takeover, a timeout, or a delete/markStale/clear —
        // skips its write, so a late revalidation can't resurrect a key the caller removed.
        if (this.inflight.get(key) === ref.current) {
          // Emitting and continuing keeps a storage write failure from discarding the freshly computed value the caller
          // is waiting on; the next read recomputes.
          try {
            await this.storage.setItem(key, serialized);
          } catch (error) {
            mochiEvents.emit('cache:error', { key, operation: 'set', error });
          }
        }
        // Round-trip through (de)serialize so a fresh compute returns the same shape
        // a later cache hit would, even with non-identity transforms.
        return (this.deserialize(serialized) as CacheEntry).value as T;
      } finally {
        await this.removeMarker(key, runId);
      }
    })();

    const guarded = this.inflightTimeout > 0 && Number.isFinite(this.inflightTimeout) ? withTimeout(work, this.inflightTimeout, key) : work;
    const promise = guarded.finally(() => {
      if (this.inflight.get(key) === ref.current) {
        this.inflight.delete(key);
      }
    });

    ref.current = promise;
    this.inflight.set(key, promise);
    return promise;
  }

  // The advisory cross-process in-flight marker is keyed separately from the value.
  // FileStorage hashes this into its own file, so it never collides with the entry.
  private markerKey(key: string): string {
    return `mochi:inflight:${key}`;
  }

  private markerLeaseEnabled(): boolean {
    return this.crossProcessInflight && this.inflightTimeout > 0 && Number.isFinite(this.inflightTimeout);
  }

  // True when a fresh advisory marker exists and this process isn't already computing the key locally, where local
  // coalescing would hand callers the fresh value anyway — the signal to serve our in-hand value instead of piling on a
  // duplicate regen. A read failure degrades to false, so the marker can only remove work.
  private async deferToPeer(key: string): Promise<boolean> {
    if (!this.markerLeaseEnabled() || this.inflight.has(key)) {
      return false;
    }
    let raw: unknown;
    try {
      raw = await this.storage.getItem(this.markerKey(key));
    } catch {
      return false;
    }
    const marker = raw as { startedAt?: number } | null;
    if (marker == null || typeof marker.startedAt !== 'number') {
      return false;
    }
    if (this.now() - marker.startedAt >= this.inflightTimeout) {
      return false;
    }
    mochiEvents.emit('cache:inflight:deferred', { key });
    return true;
  }

  private async writeMarker(key: string, runId: string): Promise<void> {
    if (!this.markerLeaseEnabled()) {
      return;
    }
    try {
      await this.storage.setItem(this.markerKey(key), { startedAt: this.now(), runId });
    } catch (error) {
      mochiEvents.emit('cache:error', { key, operation: 'set', error });
    }
  }

  /**
   * With a `runId`, only remove the marker if that run still owns it (a stale
   * settle must not clear a newer run's marker and un-defer the fleet); the
   * read-then-remove is not atomic, but the marker is advisory so the worst case
   * is one extra duplicate regen. Without a `runId` (delete/invalidate paths),
   * remove unconditionally.
   */
  private async removeMarker(key: string, runId?: string): Promise<void> {
    if (!this.markerLeaseEnabled()) {
      return;
    }
    try {
      if (runId !== undefined) {
        const raw = (await this.storage.getItem(this.markerKey(key))) as { runId?: string } | null;
        if (raw != null && raw.runId !== undefined && raw.runId !== runId) {
          return;
        }
      }
      await this.storage.removeItem(this.markerKey(key));
    } catch (error) {
      mochiEvents.emit('cache:error', { key, operation: 'remove', error });
    }
  }

  private emitRead<T>(key: string, value: T, status: CacheStatus): CacheResult<T> {
    mochiEvents.emit('cache:read', { key, status });
    return { value, status };
  }

  private now(): number {
    return Date.now();
  }
}
