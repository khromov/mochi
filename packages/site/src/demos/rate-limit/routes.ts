import { mkdirSync } from 'node:fs';
import { Mochi, getRequestContext, sqliteStore } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Persist rate-limit counters to SQLite so they survive restarts — the default
// store is in-memory (and sqliteStore() without a path is too). bun:sqlite won't
// create the parent dir, and ./db is gitignored.
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
