import { randomBytes } from 'node:crypto';
import { applyFilter } from './extensions';
import type { MochiServeOptions } from './types';

/**
 * Baseline response security headers. These three are safe to send on every
 * response without breaking normal apps, so they're on by default:
 *
 * - `X-Content-Type-Options: nosniff` — stops MIME sniffing (a classic XSS vector
 *   where a response is reinterpreted as a script).
 * - `Referrer-Policy: strict-origin-when-cross-origin` — keeps full URLs (which
 *   may carry tokens) from leaking to other origins.
 * - `X-Frame-Options: SAMEORIGIN` — blocks clickjacking via foreign framing.
 *
 * Content-Security-Policy is deliberately NOT here — a useful CSP is app-specific
 * and needs per-request nonces for inline scripts (see `cspNonce`), so it's
 * opt-in. Add one (and HSTS) via the `security:headers` filter or middleware.
 */
export interface MochiSecurityHeadersOptions {
  /** Send `X-Content-Type-Options: nosniff`. Default: `true`. */
  contentTypeOptions?: boolean;
  /** `Referrer-Policy` value, or `false` to omit. Default: `'strict-origin-when-cross-origin'`. */
  referrerPolicy?: string | false;
  /** `X-Frame-Options` value, or `false` to omit. Default: `'SAMEORIGIN'`. */
  frameOptions?: string | false;
}

/**
 * Resolve the baseline security headers as a plain record. Honors the
 * `securityHeaders` serve option (`false` disables the framework defaults
 * entirely) and runs the result through the `security:headers` filter so apps
 * can add HSTS / CSP or drop a default. Call once at startup; the resulting
 * record is applied per response.
 */
export function resolveSecurityHeaders(options: MochiServeOptions): Record<string, string> {
  const setting = options.securityHeaders;
  const cfg: MochiSecurityHeadersOptions = setting && typeof setting === 'object' ? setting : {};

  const headers: Record<string, string> = {};
  if (setting !== false) {
    if (cfg.contentTypeOptions !== false) {
      headers['X-Content-Type-Options'] = 'nosniff';
    }
    if (cfg.referrerPolicy !== false) {
      headers['Referrer-Policy'] = cfg.referrerPolicy ?? 'strict-origin-when-cross-origin';
    }
    if (cfg.frameOptions !== false) {
      headers['X-Frame-Options'] = cfg.frameOptions ?? 'SAMEORIGIN';
    }
  }

  return applyFilter('security:headers', headers, { options });
}

/**
 * Add the resolved baseline headers to a response's `Headers`, leaving any the
 * handler or middleware already set untouched (so a route can override a
 * per-response value). Applied last, after `filterResponseHeaders`, so an app
 * can't accidentally strip them.
 */
export function applyDefaultSecurityHeaders(headers: Headers, defaults: Record<string, string>): void {
  for (const name in defaults) {
    if (!headers.has(name)) {
      headers.set(name, defaults[name]!);
    }
  }
}

/**
 * Generate a fresh per-request CSP nonce: 16 random bytes, base64. Long enough
 * to be unguessable, the format `script-src 'nonce-...'` expects.
 */
export function generateCspNonce(): string {
  return randomBytes(16).toString('base64');
}
