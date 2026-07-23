import { requestCache, requestMemo } from 'mochi-framework';

export interface Counters {
  uncached: number;
  cached: number;
}

/**
 * Per-request tallies, themselves stored in the request cache — so every
 * component on the page increments the same object without module-level state
 * leaking between requests.
 */
export function counters(): Counters {
  return requestCache('demo:mochicoin:counters', () => ({ uncached: 0, cached: 0 }));
}

/** Rounds of SHA-256 stretching per block. Enough to cost ~15ms of real CPU. */
const ROUNDS = 60_000;

/**
 * MochiCoin's (entirely made-up) proof-of-work: stretch the block payload
 * through 60k rounds of SHA-256 and take the result as the block hash. Pure
 * CPU — no I/O to hide behind, so a repeated call costs a repeated 15ms.
 */
function mine(blockId: string): string {
  let digest = new Bun.CryptoHasher('sha256').update(`mochicoin:${blockId}`).digest();
  for (let i = 1; i < ROUNDS; i++) {
    digest = new Bun.CryptoHasher('sha256').update(digest).digest();
  }
  return Buffer.from(digest).toString('hex');
}

export function blockHashUncached(blockId: string): string {
  counters().uncached++;
  return mine(blockId);
}

/**
 * The same work, memoized for the duration of one request. The counter lives
 * inside the wrapped function, so it only ticks on a miss — a hit never runs
 * this body at all.
 */
export const blockHashCached = requestMemo(
  (blockId: string): string => {
    counters().cached++;
    return mine(blockId);
  },
  { namespace: 'demo:mochicoin' },
);
