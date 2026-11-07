import { MochiCache } from 'mochi-framework';

export const pokemonCache = new MochiCache({
  minTimeToStale: 14_400_000,
  maxTimeToLive: 86_400_000,
});
