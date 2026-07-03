import { stringify as devalueStringify } from 'devalue';
import { json, negotiate } from './utils';

/**
 * True when the request was made by the `enhance` attachment (or any client that opts
 * into the JSON envelope). `x-mochi-action: true` is the unambiguous signal
 * and is checked first; otherwise proper q-value content negotiation on the
 * `Accept` header determines preference, so `Accept: text/html,
 * application/json;q=0.01` is correctly treated as NOT enhanced.
 *
 * `text/html` is listed first so a wildcard `Accept` header (a plain `curl -X POST`)
 * prefers the HTML re-render — only an explicit `Accept: application/json` (or the
 * `x-mochi-action` header) opts into the JSON envelope.
 */
export function isEnhanceRequest(req: Request): boolean {
  if (req.method !== 'POST') {
    return false;
  }
  if (req.headers.get('x-mochi-action') === 'true') {
    return true;
  }
  const accept = req.headers.get('accept') ?? '*/*';
  return negotiate(accept, ['text/html', 'application/json']) === 'application/json';
}

/**
 * Encode `data` with devalue so rich types (Date, Map, Set, BigInt, cyclic refs)
 * survive the wire. The outer JSON envelope is plain `JSON.stringify` — only
 * the `data` field is double-encoded.
 */
function encodeData(data: unknown): string | undefined {
  if (data === undefined) {
    return undefined;
  }
  return devalueStringify(data);
}

interface EnhanceJsonOptions {
  emptyResult?: boolean;
}

/**
 * Build the success envelope. `status` follows SvelteKit: 204 when the action
 * returned nothing, 200 otherwise. HTTP status of the response itself is 200.
 */
export function jsonSuccess(data: Record<string, unknown> | undefined, opts: EnhanceJsonOptions = {}): Response {
  const status = opts.emptyResult ? 204 : 200;
  const body: { type: 'success'; status: number; data?: string } = { type: 'success', status };
  const encoded = encodeData(data);
  if (encoded !== undefined) {
    body.data = encoded;
  }
  return json(body, { status: 200 });
}

/**
 * Build the failure envelope from a `fail()` result. HTTP status is 200 — the
 * failure status lives in the body so client parsing isn't gated on
 * `response.ok` (matches SvelteKit).
 */
export function jsonFailure(status: number, data: Record<string, unknown>): Response {
  const body: { type: 'failure'; status: number; data?: string } = { type: 'failure', status };
  const encoded = encodeData(data);
  if (encoded !== undefined) {
    body.data = encoded;
  }
  return json(body, { status: 200 });
}

/**
 * Build the redirect envelope. HTTP status is 200 — the actual redirect status
 * lives in the body's `status` field. The client navigates via
 * `window.location.assign(location)`.
 */
export function jsonRedirect(status: number, location: string): Response {
  return json({ type: 'redirect', status, location }, { status: 200 });
}

/**
 * Build the error envelope. HTTP status carries the error code (matches
 * SvelteKit), so XHR error logging tools see the failure.
 */
export function jsonError(status: number, message: string): Response {
  return json({ type: 'error', status, error: { message } }, { status });
}
