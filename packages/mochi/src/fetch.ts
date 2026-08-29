// Isomorphic resilient fetch wrapper. Lives on native `fetch` + `AbortSignal`
// only (no node: imports, no env branching) so the exact same module runs in
// the Bun server, during SSR, and in a hydrated island — imported everywhere as
// `mochiFetch` from 'mochi-framework' (often aliased to `fetch` as a drop-in).
// Returns a standard `Response` — nothing bespoke to learn.

export interface MochiFetchOptions extends RequestInit {
  /** Prefixes a relative `input`. Absolute inputs (and `Request` inputs) ignore it. */
  baseUrl?: string;
  /** Per-attempt timeout in ms, bounding time-to-response-headers (not the body download). Each retry gets a fresh timeout. Default 10_000. */
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
// A hostile or misconfigured upstream can send an enormous `Retry-After`; cap
// the honored value so it can't hang the client for minutes/hours per attempt.
const MAX_RETRY_AFTER_MS = 60_000;

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
  // A raw `ReadableStream` body is one-shot: it can't be replayed across
  // attempts, so retrying would send a locked/empty body. Fall back to a single
  // attempt in that case. (`Request` inputs are cloned per attempt below, so
  // their bodies stay replayable.)
  const bodyIsOneShot = init.body instanceof ReadableStream;
  const methodRetryable = !bodyIsOneShot && retryMethods.some((m) => m.toUpperCase() === method);
  const maxAttempts = Math.max(0, retries) + 1;
  const retryPossible = methodRetryable && maxAttempts > 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Fresh per-attempt timeout via a controller we can clear once the response
    // headers arrive — otherwise the timer would keep governing (and could
    // abort) a slow body read the caller is legitimately streaming.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeout);
    const signal = userSignal ? AbortSignal.any([userSignal, controller.signal]) : controller.signal;

    let response: Response;
    try {
      // Clone a retryable `Request` input so a later attempt doesn't reuse its
      // already-consumed body. The original stays pristine for the next clone.
      const attemptInput = input instanceof Request ? (retryPossible ? input.clone() : input) : target;
      response = await fetch(attemptInput, { ...init, signal });
    } catch (err) {
      clearTimeout(timer);
      // A caller-triggered abort is intentional — surface it immediately and
      // never treat it as a retryable transport failure.
      if (userSignal?.aborted) {
        throw err;
      }
      lastError = err;
      if (methodRetryable && attempt < maxAttempts) {
        await sleep(backoffDelay(attempt, retryDelay), userSignal);
        continue;
      }
      throw err;
    }

    // Headers are in hand; stop the per-attempt timeout so it can never abort a
    // slow body read. The caller's own `signal` still governs the returned body.
    clearTimeout(timer);

    if (methodRetryable && attempt < maxAttempts && retryStatusCodes.includes(response.status)) {
      const delay = retryAfterDelay(response) ?? backoffDelay(attempt, retryDelay);
      // Release the body before discarding the response, or the connection leaks.
      // A `cancel()` on an already-errored body (e.g. the upstream reset the
      // connection mid-stream) rejects — swallow it so it can't abort the retry.
      await response.body?.cancel().catch(() => {});
      await sleep(delay, userSignal);
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
  // Cap the ceiling *before* jittering. Clamping the jittered value instead
  // would collapse a large fraction of high-attempt delays onto exactly the cap
  // (no spread), reintroducing the lockstep stampede full jitter exists to avoid.
  const ceiling = Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  // Full jitter (random in [0, ceiling]) spreads retries so a fleet of clients
  // doesn't stampede a recovering upstream in lockstep.
  return Math.random() * ceiling;
}

function retryAfterDelay(response: Response): number | null {
  const header = response.headers.get('retry-after')?.trim();
  if (!header) {
    return null;
  }
  // Numeric form is a non-negative integer delta in seconds (per RFC 9110).
  // Match it explicitly rather than via `Number()` — a hex-ish or scientific
  // header (`'0x0'`, `'1e3'`) coerces to a bogus number (0, 1000, …), which
  // would skip or distort backoff; those must fall through to the date form,
  // then to exponential backoff.
  if (/^\d+$/.test(header)) {
    return clampRetryAfter(Number(header) * 1000);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return clampRetryAfter(date - Date.now());
  }
  return null;
}

function clampRetryAfter(ms: number): number {
  return Math.min(Math.max(0, ms), MAX_RETRY_AFTER_MS);
}

// Abortable so a caller's `signal` firing mid-backoff is surfaced right away
// instead of waiting out the full delay (which `Retry-After` can make long).
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
