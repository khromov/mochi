import { MochiCache, MemoryStorage } from 'mochi-framework';

export const ITEM_CACHE_MAX_ENTRIES = 10_000;

// `maxAge` bounds how long an entry lives but not how many there are, so walking ids fast could still fill the heap.
class BoundedMemoryStorage extends MemoryStorage {
  override setItem(key: string, value: unknown): void {
    super.setItem(key, value);
    if (this.count() > ITEM_CACHE_MAX_ENTRIES) {
      // Evicting the oldest tenth at once keeps the O(n) `keys()` copy off the per-insert path.
      for (const oldest of this.keys().slice(0, ITEM_CACHE_MAX_ENTRIES / 10)) {
        this.removeItem(oldest);
      }
    }
  }
}

export const itemCache = new MochiCache({
  minTimeToStale: 60_000,
  maxTimeToLive: 600_000,
  // Item ids come from the URL, so the default unbounded MemoryStorage would grow one entry per distinct id forever.
  storage: new BoundedMemoryStorage({ maxAge: 600_000, purgeInterval: 60_000 }),
});
