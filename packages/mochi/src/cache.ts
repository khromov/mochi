import { mochiEvents } from './events';

export type CacheStatus = 'fresh' | 'stale' | 'expired' | 'miss';

/** Pluggable key/value backend. Defaults to an in-memory Map. */
export interface Storage {
  getItem(key: string): unknown | null;
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
  /** Serialize a value before it is written to storage. Defaults to identity. */
  serialize?: (value: unknown) => unknown;
  /** Deserialize a value read back from storage. Defaults to identity. */
  deserialize?: (value: unknown) => unknown;
}

export interface CacheResult<T> {
  value: T;
  status: CacheStatus;
}

class MemoryStorage implements Storage {
  private store = new Map<string, unknown>();

  getItem(key: string): unknown | null {
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
  private serialize: (value: unknown) => unknown;
  private deserialize: (value: unknown) => unknown;
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
    const stored = this.storage.getItem(key);
    const createdAt = this.readTime(key);

    if (stored == null || createdAt == null) {
      const value = await this.run(key, fn);
      return this.emitRead(key, value, 'miss');
    }

    const cached = this.deserialize(stored) as T;
    const age = this.now() - createdAt;

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
    this.storage.removeItem(this.timeKey(key));
    this.inflight.delete(key);
  }

  // Run `fn` once per key even under concurrent callers, then persist the result.
  private run<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const value = await fn();
      this.storage.setItem(key, this.serialize(value));
      this.storage.setItem(this.timeKey(key), this.now());
      return value;
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  private emitRead<T>(key: string, value: T, status: CacheStatus): CacheResult<T> {
    mochiEvents.emit('cache:read', { key, status });
    return { value, status };
  }

  private readTime(key: string): number | null {
    const raw = this.storage.getItem(this.timeKey(key));
    return typeof raw === 'number' ? raw : null;
  }

  private timeKey(key: string): string {
    return `${key}__t`;
  }

  private now(): number {
    return Date.now();
  }
}
