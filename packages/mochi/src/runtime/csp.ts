import { AsyncLocalStorage } from 'node:async_hooks';
import { pinGlobal } from '../utils/globalState';
import { requestContext } from './requestContext';

/**
 * The nonce for requests the fetch fallback answers (the unmatched-route 404, assets, a user `fetch`), which build no
 * request context but still run middleware. Pinned for the same reason `requestContext` is.
 */
export const cspNonceStore = pinGlobal('__mochi_csp_nonce__', () => new AsyncLocalStorage<string>());

/**
 * The current request's CSP nonce, or `undefined` when `csp` is off or outside a request. Use it to build a
 * `Content-Security-Policy` header that matches the nonce Mochi stamps on its own `<script>` tags.
 */
export function getCspNonce(): string | undefined {
  return requestContext.getStore()?.cspNonce ?? cspNonceStore.getStore();
}

/** 128 random bits, base64-encoded — the form `script-src 'nonce-…'` expects. */
export function generateCspNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

export function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${nonce}"` : '';
}

// The attribute goes in at the tag boundary rather than by rewriting finished HTML, where a `<script` inside an inlined bundle would also match.
export function inlineScript(js: string, attr: string): string {
  return `<script${attr}>${js}</script>`;
}
