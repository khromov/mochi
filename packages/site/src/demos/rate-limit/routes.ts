import { mkdirSync } from 'node:fs';
import { Mochi, getRequestContext, sqliteStore } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Persist rate-limit counters to SQLite so they survive restarts; bun:sqlite won't create ./db itself, and it's gitignored.
mkdirSync('./db', { recursive: true });
const store = sqliteStore({ path: './db/rate-limit.sqlite' });

export const routes: Record<string, MochiRouteValue> = {
  '/demos/rate-limit': Mochi.page('./src/demos/rate-limit/RateLimit.svelte', {
    rateLimit: { limit: 5, window: '1m', store },
    serverProps: () => {
      const rateLimit = getRequestContext().rateLimit;
      return {
        used: rateLimit ? rateLimit.limit - rateLimit.remaining : 1,
        limit: rateLimit?.limit ?? 5,
        resetIn: rateLimit?.resetIn ?? 60,
      };
    },
  }),
};
