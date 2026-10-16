import type { Handle } from 'mochi-framework';

// Rate-limit stub.
//
// STUB MODULE. Returns a pass-through Mochi middleware. The real rate-limiting
// battery (tasks/rate-limiting.md) will keep counters in a pluggable store,
// support multiple keying strategies (IP, IP+UA, cookie), use the proxy-aware
// client IP (`getClientAddress`), and short-circuit with a 429 + `Retry-After`
// when a limit is exceeded.

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  max?: number;
  /** Window length in milliseconds. */
  windowMs?: number;
  /** Only rate-limit requests whose path starts with one of these. */
  paths?: string[];
}

/**
 * Compose this into `Mochi.serve({ handle: sequence(rateLimit(), …) })`.
 *
 * TODO: implement the counter store + windowing and return 429 with
 * `Retry-After` when `max` is exceeded within `windowMs`. For now every request
 * passes through untouched.
 */
export function rateLimit(_opts: RateLimitOptions = {}): Handle {
  return async ({ event, resolve }) => {
    // TODO: look up the counter for the derived key, increment, and short-circuit
    // with a 429 (+ Retry-After header) when over the limit. See getClientAddress
    // in mochi-framework for the proxy-aware client IP.
    return resolve(event);
  };
}
