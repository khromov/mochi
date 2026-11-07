import { stringify as devalueStringify } from 'devalue';
import { json, negotiate } from '../utils';

/**
 * True when the request came from the `enhance` attachment, or any client opting into the JSON envelope.
 * `x-mochi-action: true` is the unambiguous signal and is checked first; otherwise q-value content negotiation on
 * `Accept` decides, so `Accept: text/html, application/json;q=0.01` reads as plain. `text/html` is listed first, so a
 * wildcard `Accept` from a plain `curl -X POST` prefers the HTML re-render.
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

// devalue lets rich types (Date, Map, Set, BigInt, cyclic refs) survive the wire; the outer envelope is plain
// `JSON.stringify`, so only `data` is double-encoded.
function encodeData(data: unknown): string | undefined {
  if (data === undefined) {
    return undefined;
  }
  return devalueStringify(data);
}

interface EnhanceJsonOptions {
  emptyResult?: boolean;
}

/** Build the success envelope. Its `status` follows SvelteKit — 204 when the action returned nothing, 200 otherwise — while the response's own HTTP status is 200. */
export function jsonSuccess(data: Record<string, unknown> | undefined, opts: EnhanceJsonOptions = {}): Response {
  const status = opts.emptyResult ? 204 : 200;
  const body: { type: 'success'; status: number; data?: string } = { type: 'success', status };
  const encoded = encodeData(data);
  if (encoded !== undefined) {
    body.data = encoded;
  }
  return json(body, { status: 200 });
}

/** Build the failure envelope from a `fail()` result. HTTP status is 200 and the failure status lives in the body, so client parsing isn't gated on `response.ok`. */
export function jsonFailure(status: number, data: Record<string, unknown>): Response {
  const body: { type: 'failure'; status: number; data?: string } = { type: 'failure', status };
  const encoded = encodeData(data);
  if (encoded !== undefined) {
    body.data = encoded;
  }
  return json(body, { status: 200 });
}

/** Build the redirect envelope. HTTP status is 200 with the real redirect status in the body's `status`, and the client navigates via `window.location.assign(location)`. */
export function jsonRedirect(status: number, location: string): Response {
  return json({ type: 'redirect', status, location }, { status: 200 });
}

/** Build the error envelope, with the error code on the HTTP status so XHR error-logging tools see the failure. */
export function jsonError(status: number, message: string): Response {
  return json({ type: 'error', status, error: { message } }, { status });
}
