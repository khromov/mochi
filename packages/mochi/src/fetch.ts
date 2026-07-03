// Isomorphic resilient fetch wrapper. Lives on native `fetch` + `AbortSignal`
// only (no node: imports, no env branching) so the exact same module runs in
// the Bun server, during SSR, and in a hydrated island. `Mochi.fetch` is a
// thin server-side alias; `.svelte` files import `mochiFetch` from
// 'mochi-framework'. Returns a standard `Response` — nothing bespoke to learn.

export interface MochiFetchOptions extends RequestInit {
  /** Prefixes a relative `input`. Absolute inputs (and `Request` inputs) ignore it. */
  baseUrl?: string;
  /** Per-attempt timeout in ms. Each retry gets a fresh timeout. Default 10_000. */
  timeout?: number;
  /** Additional attempts after the first. Default 2 (→ 3 total attempts). */
  retries?: number;
  /** Base backoff in ms; grows exponentially with full jitter, capped. Default 300. */
  retryDelay?: number;
  /** Response statuses that trigger a retry. Default 408, 429, 500, 502, 503, 504. */
  retryStatusCodes?: number[];
  /** Methods eligible for retry (case-insensitive). Default idempotent methods only. */
  retryMethods?: string[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];
// POST/PATCH are intentionally excluded: retrying a write that the server may
// have already processed (e.g. a POST that timed out after committing) risks a
// duplicate side-effect. Opt them in explicitly via `retryMethods`.
const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'];
const MAX_BACKOFF_MS = 10_000;

export async function mochiFetch(input: string | URL | Request, options: MochiFetchOptions = {}): Promise<Response> {
  const {
    baseUrl,
    timeout = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY_MS,
    retryStatusCodes = DEFAULT_RETRY_STATUS_CODES,
    retryMethods = DEFAULT_RETRY_METHODS,
    signal: userSignal,
    ...init
  } = options;

  const target = resolveUrl(input, baseUrl);
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const methodRetryable = retryMethods.some((m) => m.toUpperCase() === method);
  const maxAttempts = Math.max(0, retries) + 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Fresh per-attempt timeout, composed with any caller-supplied signal so
    // an external cancel still propagates.
    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = userSignal ? AbortSignal.any([userSignal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(target, { ...init, signal });
    } catch (err) {
      // A caller-triggered abort is intentional — surface it immediately and
      // never treat it as a retryable transport failure.
      if (userSignal?.aborted) {
        throw err;
      }
      lastError = err;
      if (methodRetryable && attempt < maxAttempts) {
        await sleep(backoffDelay(attempt, retryDelay));
        continue;
      }
      throw err;
    }

    if (methodRetryable && attempt < maxAttempts && retryStatusCodes.includes(response.status)) {
      const delay = retryAfterDelay(response) ?? backoffDelay(attempt, retryDelay);
      // Release the body before discarding the response, or the connection leaks.
      await response.body?.cancel();
      await sleep(delay);
      continue;
    }

    return response;
  }

  // Only reachable if `retries` was somehow negative enough to yield 0 attempts.
  throw lastError ?? new Error('mochiFetch: no attempts were made');
}

function resolveUrl(input: string | URL | Request, baseUrl: string | undefined): string | URL | Request {
  if (!baseUrl || input instanceof Request) {
    return input;
  }
  // `new URL(relative, base)` applies the base; an absolute `input` ignores it.
  return new URL(input instanceof URL ? input.href : input, baseUrl);
}

function backoffDelay(attempt: number, base: number): number {
  const ceiling = base * 2 ** (attempt - 1);
  // Full jitter (random in [0, ceiling]) spreads retries so a fleet of clients
  // doesn't stampede a recovering upstream in lockstep.
  return Math.min(Math.random() * ceiling, MAX_BACKOFF_MS);
}

function retryAfterDelay(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
