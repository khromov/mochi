// Isomorphic proof-of-work helpers — imported by both the MochiCaptcha island
// (client bundle) and the server-side verifier, so no server-only imports here.
import { sha256 } from '@noble/hashes/sha2.js';

export const CAPTCHA_AAD = 'mochi-captcha';

// The PoW challenge is the last link of a hash chain the widget advances one
// link per slider step, so the challenge is never present in the page — it
// only exists once the slide progression has actually been run.
export const CAPTCHA_STEPS = 10;

/**
 * How long one brute-force slice may run before yielding to paint. The clock is read only between batches, so the real
 * bound is `max(CAPTCHA_SOLVE_SLICE_MS, one batch of CAPTCHA_SOLVE_BATCH hashes)`, and the batch is sized so the second
 * term stays under the first on any device slow enough to matter.
 */
export const CAPTCHA_SOLVE_SLICE_MS = 8;

/**
 * Attempts between clock reads. Measured on Bun 1.3/arm64, one attempt — `powInput` plus a ~70-byte digest — costs
 * ~1360ns against ~27ns for `Date.now()`, so checking every 32 adds ~0.06% overhead while capping the un-yielded run at
 * 32 hashes. A larger batch buys nothing measurable and widens the worst main-thread block on a slow phone.
 */
export const CAPTCHA_SOLVE_BATCH = 32;

/**
 * Default total *active* solve time the widget spends before giving up and showing an error. Active rather than
 * wall-clock, since a backgrounded mobile tab stops scheduling slices entirely and returning to a failed captcha you
 * never had a chance to solve is worse than waiting. Set app-wide via the `captcha:solveBudgetMs` filter or per-widget
 * via the `solveBudgetMs` prop; it's a client-side patience bound, so unlike `bits` it stays outside the token.
 */
export const DEFAULT_CAPTCHA_SOLVE_BUDGET_MS = 60_000;

export function chainInput(prev: string, step: number): string {
  return `${prev}:step${step}`;
}

export function powInput(challenge: string, powNonce: string): string {
  return `${challenge}:${powNonce}`;
}

/** Lowercase hex, matching node:crypto's digest('hex') on the server side. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

const encoder = new TextEncoder();

/**
 * Synchronous SHA-256 from `@noble/hashes`, a pure-JS implementation standing in for WebCrypto. The widget used to hash
 * through the async `crypto.subtle.digest`, so a 16-bit proof-of-work meant ~65k sequentially-awaited promises, each a
 * chance for a transient rejection to strand the widget on "Verifying…" and slow enough on a phone to be felt. Hashing
 * synchronously turns the chain into a plain loop and the solve into an interruptible one, and drops the secure-context
 * requirement `crypto.subtle` carries, so the widget works over plain http.
 *
 * pow.test.ts cross-checks it byte-for-byte against `node:crypto`, which the server verifies with — the two must agree
 * exactly or no real submission would pass.
 */
export function sha256Bytes(input: string): Uint8Array {
  return sha256(encoder.encode(input));
}

export function sha256Hex(input: string): string {
  return toHex(sha256Bytes(input));
}

/**
 * Advance the token through the full slide-step chain. The hasher is injected so
 * the server can stay on `node:crypto` while the widget uses the JS one above
 * — the two are cross-checked against each other in pow.test.ts.
 */
export function deriveChain(token: string, hashHex: (input: string) => string = sha256Hex): string {
  let chain = token;
  for (let step = 1; step <= CAPTCHA_STEPS; step++) {
    chain = hashHex(chainInput(chain, step));
  }
  return chain;
}

export type PowSliceResult = { nonce: string } | { next: number };

/**
 * Brute-force nonces for up to `sliceMs`, resuming from `from`. Returns either
 * the solution or the nonce to resume at, so the caller can yield to the browser
 * between slices instead of blocking the main thread for the whole solve.
 */
export function solvePowSlice(challenge: string, bits: number, from: number, sliceMs: number, now: () => number = Date.now): PowSliceResult {
  const deadline = now() + sliceMs;
  let n = from;
  for (;;) {
    for (let i = 0; i < CAPTCHA_SOLVE_BATCH; i++, n++) {
      if (leadingZeroBits(sha256Bytes(powInput(challenge, String(n)))) >= bits) {
        return { nonce: String(n) };
      }
    }
    if (now() >= deadline) {
      return { next: n };
    }
  }
}
