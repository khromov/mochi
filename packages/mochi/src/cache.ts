import { randomUUID } from 'node:crypto';
import { MemoryStorage } from './cache-storage';
import { mochiEvents } from './events';

export type CacheStatus = 'fresh' | 'stale' | 'expired' | 'miss';

export interface SweepOptions {
  /** Also return the plaintext keys removed by this sweep. Default `false`. */
  reportKeys?: boolean;
}

export interface SweepResult {
  /** Entries removed by this sweep. */
  removed: number;
  /**
   * The removed keys, when `reportKeys` was requested and the backend supports it.
   * May be shorter than `removed`: `FileStorage` counts `.tmp` writes and corrupt
   * files it cannot name. Absent entirely when `reportKeys` wasn't asked for.
   */
  removedKeys?: string[];
}

/**
 * Pluggable key/value backend. Defaults to an in-memory Map.
 *
 * Methods may be synchronous (in-memory `Map`, `bun:sqlite`) or asynchronous
 * (Redis, network-backed stores) — the cache awaits every call, so returning a
 * `Promise` is fully supported.
 */
export interface Storage {
  getItem(key: string): unknown | Promise<unknown>;
  setItem(key: string, value: unknown): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  /** Remove every entry from the backend. */
  clear(): void | Promise<void>;
  /**
   * Optional age-based eviction, callable on demand by a caller-driven janitor (e.g. `ImageCache`).
   * `FileStorage` and `MemoryStorage` both implement it.
   *
   * `reportKeys` asks the backend to also return the plaintext keys it removed, so a janitor can
   * attribute removals without re-enumerating the whole backend. Opt-in because it can cost the
   * backend extra work (`FileStorage` must read each expired entry's envelope before unlinking).
   * `removedKeys` may be shorter than `removed` — a backend reports only the removals it can name.
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
   * Max ms a single recompute may hold the per-key in-flight lock. If `fn` hasn't
   * settled by then the lock is released and coalesced callers reject with a
   * timeout error, so a hung upstream can't trap every waiter forever. The
   * abandoned run keeps executing but its result is discarded (the stored-write
   * guard already drops superseded runs). Default 1 hour; `<= 0` or non-finite
   * disables the timeout.
   */
  inflightTimeout?: number;
  /**
   * Best-effort cross-process request coalescing over a shared `storage` backend.
   * A recompute writes an advisory `mochi:inflight:<key>` marker; a peer process
   * that hits a stale/expired entry while the marker is fresh serves its in-hand
   * value instead of piling on a duplicate regeneration. Advisory only (no atomic
   * lock), leased to `inflightTimeout` so a crashed peer's marker self-expires, and
   * a no-op unless `inflightTimeout` is finite and `> 0`. Pointless with the default
   * process-local `MemoryStorage`; intended for a shared `FileStorage`. Default false.
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

// Race a recompute against a timeout so a hung `fn` can't hold the per-key
// in-flight lock forever. `Promise.race` attaches a reaction to `work`, so a late
// rejection after the timeout wins the race is still considered handled (no
// unhandled-rejection warning); `run`'s stored-write guard discards its result.
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
      // Serve the stale value immediately and refresh in the background. A
      // failing upstream would otherwise keep us serving stale silently until
      // maxTimeToLive — surface it so logging/metrics can see the degradation.
      mochiEvents.emit('cache:revalidate', { key });
      void this.run(key, fn).catch((error) => {
        mochiEvents.emit('cache:revalidate:failed', { key, error });
      });
      return this.emitRead(key, cached, 'stale');
    }

    // Past maxTimeToLive: recompute. But if a peer is already refreshing (fresh
    // marker) and we're within a bounded grace window, serve the old value rather
    // than pile on a duplicate synchronous regen; past the bound, recompute anyway
    // so a wedged fleet never serves arbitrarily ancient bytes.
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
    // Drop any advisory marker so a just-invalidated key doesn't briefly make
    // peers defer to a regeneration that will no longer happen.
    await this.removeMarker(key);
    mochiEvents.emit('cache:delete', { key });
  }

  /**
   * Read a key's current status and value WITHOUT running `fn` or revalidating —
   * a pure probe. Returns `null` on a miss (nothing cached). Unlike
   * `fetchWithStatus` this never recomputes, emits no `cache:read`, and reports
   * `'expired'` for an entry past `maxTimeToLive` rather than refreshing it.
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
   * Write `value` to `key` unconditionally, stamped fresh — overwriting whatever is
   * there. The counterpart to `fetch`, which only computes on a miss/stale and so
   * can't replace a still-present entry.
   *
   * Use this rather than `delete` + `fetch`: that sequence leaves the key absent for
   * the whole write, during which concurrent readers see a miss and each start their
   * own recompute. `setItem` is a single atomic replace on `FileStorage` (temp file +
   * rename), so a reader sees either the old value or the new one, never nothing.
   *
   * Drops the key's in-flight run, so a recompute already underway settles without
   * writing. As with `delete`/`markStale`, that only covers a run that has already
   * registered: a `fetch` still awaiting its initial storage read hasn't claimed the
   * slot yet, and its write will land after this one.
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
   * Backdate a key so its next read is served stale-while-revalidate: rewrite the
   * stored entry's `createdAt` to `now - minTimeToStale`, landing its age in the
   * stale window `[minTimeToStale, maxTimeToLive)`. A no-op if the key is missing
   * or already at-or-past that age (never makes an entry look fresher, never
   * un-expires one). Works through the `Storage` interface, so it applies equally
   * to `MemoryStorage` and `FileStorage`.
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
      // Publish the advisory cross-process marker before the expensive `fn` so a
      // peer that starts moments later sees it and defers (best-effort; no-op
      // unless crossProcessInflight is on). Removed once this run settles.
      await this.writeMarker(key, runId);
      try {
        const value = await fn();
        const serialized = this.serialize({ value, createdAt: this.now() } satisfies CacheEntry);
        // Skip the write if this run was superseded while `fn` was pending — by an
        // inflight takeover/timeout or a delete/markStale/clear that cleared the
        // slot — so a late revalidation can't resurrect a key the caller removed.
        if (this.inflight.get(key) === ref.current) {
          // A storage write failure must not discard the freshly computed value
          // the caller is waiting on — emit and continue, the next read recomputes.
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

  // True when a *remote* process is refreshing this key — a fresh advisory marker
  // exists and we aren't already computing it locally (local coalescing already
  // hands those callers the fresh value). The signal to serve our in-hand value
  // instead of piling on a duplicate regen. Any read failure degrades to false
  // (recompute as usual), so the marker can only ever remove work, never block it.
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
