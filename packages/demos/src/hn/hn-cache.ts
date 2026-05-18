import { MochiCache } from 'mochi-framework';

export const itemCache = new MochiCache({
  minTimeToStale: 60_000,
  maxTimeToLive: 600_000,
});
