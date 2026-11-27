import { MochiCache, MemoryStorage } from 'mochi-framework';

export const itemCache = new MochiCache({
  minTimeToStale: 60_000,
  maxTimeToLive: 600_000,
  // Item ids come from the URL, so the default unbounded MemoryStorage would grow one entry per distinct id forever.
  storage: new MemoryStorage({ maxAge: 600_000, purgeInterval: 60_000 }),
});
