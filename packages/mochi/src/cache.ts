import { createStaleWhileRevalidateCache, EmitterEvents } from 'stale-while-revalidate-cache';
import type { Storage, Config, CacheStatus } from 'stale-while-revalidate-cache/types';
import { mochiEvents } from './events';

export type { CacheStatus };

export interface MochiCacheOptions extends Omit<Partial<Config>, 'storage'> {
  minTimeToStale?: number;
  maxTimeToLive?: number;
  /** Custom storage backend used by stale-while-revalidate. Defaults to in-memory Map-based storage. */
  storage?: Storage;
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

export class MochiCache {
  private swr: ReturnType<typeof createStaleWhileRevalidateCache>;

  constructor(options: MochiCacheOptions = {}) {
    this.swr = createStaleWhileRevalidateCache({
      ...options,
      storage: options.storage ?? new MemoryStorage(),
      minTimeToStale: options.minTimeToStale ?? 5_000,
      maxTimeToLive: options.maxTimeToLive ?? 600_000,
    });

    const emitRead = (status: 'fresh' | 'stale' | 'expired' | 'miss') => {
      return ({ cacheKey }: { cacheKey: string }) => {
        mochiEvents.emit('cache:read', { key: cacheKey, status });
      };
    };
    this.swr.on(EmitterEvents.cacheHit, emitRead('fresh'));
    this.swr.on(EmitterEvents.cacheStale, emitRead('stale'));
    this.swr.on(EmitterEvents.cacheExpired, emitRead('expired'));
    this.swr.on(EmitterEvents.cacheMiss, emitRead('miss'));
    this.swr.on(EmitterEvents.revalidate, ({ cacheKey }: { cacheKey: string }) => {
      mochiEvents.emit('cache:revalidate', { key: cacheKey });
    });
  }

  async fetch<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const result = await this.swr<T>(key, fn);
    return result.value;
  }

  async fetchWithStatus<T>(key: string, fn: () => T | Promise<T>): Promise<CacheResult<T>> {
    const result = await this.swr<T>(key, fn);
    return { value: result.value, status: result.status };
  }

  async delete(key: string): Promise<void> {
    await this.swr.delete(key);
  }
}
