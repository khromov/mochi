import { mochiEvents } from './events';

export type CacheStatus = 'fresh' | 'stale' | 'expired' | 'miss';

/** Pluggable key/value backend. Defaults to an in-memory Map. */
export interface Storage {
  getItem(key: string): unknown;
  setItem(key: string, value: unknown): void;
  removeItem(key: string): void;
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

class MemoryStorage implements Storage {
  private store = new Map<string, unknown>();

  getItem(key: string): unknown {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const identity = (value: unknown) => value;

export class MochiCache {
  private storage: Storage;
  private minTimeToStale: number;
  private maxTimeToLive: number;
  private serialize: (entry: unknown) => unknown;
  private deserialize: (raw: unknown) => unknown;
  private inflight = new Map<string, Promise<unknown>>();

  constructor(options: MochiCacheOptions = {}) {
    this.storage = options.storage ?? new MemoryStorage();
    this.minTimeToStale = options.minTimeToStale ?? 5_000;
    this.maxTimeToLive = options.maxTimeToLive ?? 600_000;
    this.serialize = options.serialize ?? identity;
    this.deserialize = options.deserialize ?? identity;
  }

  async fetch<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const result = await this.fetchWithStatus(key, fn);
    return result.value;
  }

  async fetchWithStatus<T>(key: string, fn: () => T | Promise<T>): Promise<CacheResult<T>> {
    const raw = this.storage.getItem(key);
    const entry = raw == null ? null : (this.deserialize(raw) as CacheEntry);

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
      // Serve the stale value immediately and refresh in the background.
      mochiEvents.emit('cache:revalidate', { key });
      void this.run(key, fn).catch(() => {});
      return this.emitRead(key, cached, 'stale');
    }

    const value = await this.run(key, fn);
    return this.emitRead(key, value, 'expired');
  }

  async delete(key: string): Promise<void> {
    this.storage.removeItem(key);
    this.inflight.delete(key);
  }

  // Run `fn` once per key even under concurrent callers, then persist the result.
  private run<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const ref: { current: Promise<T> | null } = { current: null };
    const promise = (async () => {
      const value = await fn();
      const serialized = this.serialize({ value, createdAt: this.now() } satisfies CacheEntry);
      // Skip the write if this run was deleted/superseded while `fn` was pending,
      // so a late revalidation can't resurrect a key the caller already removed.
      if (this.inflight.get(key) === ref.current) {
        this.storage.setItem(key, serialized);
      }
      // Round-trip through (de)serialize so a fresh compute returns the same shape
      // a later cache hit would, even with non-identity transforms.
      return (this.deserialize(serialized) as CacheEntry).value as T;
    })().finally(() => {
      if (this.inflight.get(key) === ref.current) {
        this.inflight.delete(key);
      }
    });

    ref.current = promise;
    this.inflight.set(key, promise);
    return promise;
  }

  private emitRead<T>(key: string, value: T, status: CacheStatus): CacheResult<T> {
    mochiEvents.emit('cache:read', { key, status });
    return { value, status };
  }

  private now(): number {
    return Date.now();
  }
}
