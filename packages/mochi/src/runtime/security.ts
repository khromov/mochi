import { randomBytes } from 'node:crypto';
import { applyFilter } from '../extensions';
import type { MochiServeOptions } from '../types';

/**
 * Baseline response security headers.
 *
 * `X-Content-Type-Options: nosniff` and `Referrer-Policy` are on by default:
 * neither can change how a correct app behaves, and the framework already sends
 * `nosniff` on its own asset responses.
 *
 * `X-Frame-Options` is opt-in. It cannot express an allow-list, so sending it by
 * default would silently break legitimate cross-origin embeds (this repo's own
 * newsletter widget is one). Use CSP `frame-ancestors` when you need an
 * allow-list, and set `frameOptions` only when a blanket deny is what you want.
 *
 * Content-Security-Policy is deliberately absent: a useful CSP is app-specific
 * and needs per-request nonces for inline scripts (see `csp` / `getCspNonce()`).
 * Add one (and HSTS) via the `security:headers` filter or middleware.
 */
export interface MochiSecurityHeadersOptions {
  /** Send `X-Content-Type-Options: nosniff`. Default: `true`. */
  contentTypeOptions?: boolean;
  /** `Referrer-Policy` value, or `false` to omit. Default: `'strict-origin-when-cross-origin'`. */
  referrerPolicy?: string | false;
  /** `X-Frame-Options` value (e.g. `'SAMEORIGIN'` / `'DENY'`). Off by default — prefer CSP `frame-ancestors`. */
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
    if (cfg.frameOptions) {
      headers['X-Frame-Options'] = cfg.frameOptions;
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
    if (headers.has(name)) {
      continue;
    }
    // A route that publishes a `frame-ancestors` allow-list is deliberately
    // embeddable; stamping `X-Frame-Options` over it would deny the frame in the
    // browsers that still honour the older header.
    if (name.toLowerCase() === 'x-frame-options' && /frame-ancestors/i.test(headers.get('Content-Security-Policy') ?? '')) {
      continue;
    }
    headers.set(name, defaults[name]!);
  }
}

/** Fresh per-request CSP nonce: 16 random bytes, base64 — the format `script-src 'nonce-…'` expects. */
export function generateCspNonce(): string {
  return randomBytes(16).toString('base64');
}

/** `<script>` attribute fragment carrying the nonce, or `''` when CSP is off. */
export function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${nonce}"` : '';
}

/**
 * Stamp a nonce on every `<script>` in a framework-generated HTML fragment.
 * Only ever applied to strings Mochi itself built — never to rendered page
 * output, which would hand the nonce to whatever a component emitted.
 */
export function stampNonce(html: string, attr: string): string {
  return attr ? html.replace(/<script(?=[\s>])/g, `<script${attr}`) : html;
}
