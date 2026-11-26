import { applyFilter } from '../extensions';
import type { MochiServeOptions } from '../types';

/**
 * Baseline response security headers. `nosniff` and `Referrer-Policy` are on by default because neither changes how a
 * correctly typed app behaves; `X-Frame-Options` is opt-in because it cannot express an allow-list, so a default would
 * break legitimate cross-origin embeds.
 */
export interface MochiSecurityHeadersOptions {
  /** Send `X-Content-Type-Options: nosniff`. Default: `true`. */
  contentTypeOptions?: boolean;
  /** `Referrer-Policy` value, or `false` to omit it. Default: `'strict-origin-when-cross-origin'`. */
  referrerPolicy?: string | false;
  /** `X-Frame-Options` value (`'SAMEORIGIN'` / `'DENY'`). Off by default — prefer CSP `frame-ancestors`. */
  frameOptions?: string | false;
}

/** Resolve the `securityHeaders` option through the `security:headers` filter, once at startup. */
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

/** Add each default the response does not already carry, so a header the route or middleware set always wins. */
export function applyDefaultSecurityHeaders(headers: Headers, defaults: Record<string, string>): void {
  for (const name in defaults) {
    if (headers.has(name)) {
      continue;
    }
    // Stamping `X-Frame-Options` over a `frame-ancestors` allow-list would deny the embed in browsers that honour only the older header.
    if (name.toLowerCase() === 'x-frame-options' && /frame-ancestors/i.test(headers.get('Content-Security-Policy') ?? '')) {
      continue;
    }
    headers.set(name, defaults[name]!);
  }
}

/** Apply the defaults to a finished response, re-wrapping it when its `Headers` are immutable. */
export function addSecurityHeaders(response: Response, defaults: Record<string, string>): Response {
  try {
    applyDefaultSecurityHeaders(response.headers, defaults);
    return response;
  } catch {
    // Same fallback as `applyRateLimitHeaders`: a spec-strict `fetch()` response guards its headers.
    const headers = new Headers(response.headers);
    applyDefaultSecurityHeaders(headers, defaults);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}
