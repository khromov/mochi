/**
 * Origin-header CSRF protection for non-preflighted POSTs and other state-mutating verbs. A cross-origin request reaches
 * the server without a CORS preflight only when its Content-Type is `application/x-www-form-urlencoded`,
 * `multipart/form-data`, `text/plain`, or missing, so those are the cases gated here; browsers always send `Origin` on a
 * non-GET cross-origin request, making the comparison sufficient.
 *
 * Production refuses every protected form submission until `proxy.origin` or `proxy.hostHeader` tells the framework what
 * origin to trust. Development logs a `logger.warn` line instead and lets the request through, so callers pass
 * `development` explicitly rather than leaving prod-vs-dev intent implicit.
 *
 * Limitations:
 * - Some legacy clients and privacy proxies strip `Origin` and will be rejected;
 *   allow-list them via `trustedOrigins`.
 * - JSON/octet-stream endpoints (`Mochi.api(...)`) go unchecked, since the browser
 *   already requires a CORS preflight to send those cross-origin.
 */

import { applyFilter } from '../extensions';
import { logger } from '../utils/log';
import { resolveExpectedOrigin, type MochiProxyOptions } from './proxy';

/** The three types a cross-origin `<form>` can submit without a CORS preflight, per WHATWG. Override with the `csrf:formContentTypes` filter. */
export const DEFAULT_FORM_CONTENT_TYPES: ReadonlySet<string> = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);

/** Everything that can mutate server state from a `<form>`. Override with `csrf:protectedMethods`. */
export const DEFAULT_PROTECTED_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface MochiCsrfOptions {
  /** Compare `Origin` header against the resolved expected origin. Defaults to `true`. */
  checkOrigin?: boolean;
  /** Origins to allow even when they don't match the expected origin. */
  trustedOrigins?: string[];
}

// Browsers omit default ports in `Origin` while a reverse proxy's `x-forwarded-host` may include them, so a configured
// `https://foo.com:443` would otherwise fail to match a sent `https://foo.com`. Everything else passes through unchanged.
function normalizeOrigin(value: string): string {
  if (value.startsWith('https://')) {
    return value.replace(/:443$/, '');
  }
  if (value.startsWith('http://')) {
    return value.replace(/:80$/, '');
  }
  return value;
}

// Content-negotiated against `Accept`. `reason` attaches an extra explanation, used where the misconfiguration is the
// framework's own rather than the request's.
function csrfForbidden(req: Request, message: string, reason?: string): Response {
  const wantsJson = req.headers.get('accept') === 'application/json';
  const body = wantsJson ? JSON.stringify(reason ? { message, reason } : { message }) : reason ? `${message}\n${reason}` : message;
  return new Response(body, {
    status: 403,
    headers: {
      'Content-Type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    },
  });
}

export function isFormContentType(contentType: string | null, formContentTypes: ReadonlySet<string> = DEFAULT_FORM_CONTENT_TYPES): boolean {
  // Missing Content-Type is also a non-preflighted "simple request" — gate it like a form.
  if (!contentType) {
    return true;
  }
  const semi = contentType.indexOf(';');
  const type = (semi === -1 ? contentType : contentType.slice(0, semi)).trim().toLowerCase();
  return formContentTypes.has(type);
}

/**
 * Boot-time visibility for a production-only failure: without a trusted origin every form-action POST 403s in
 * production while development only warns per-request — invisible until deploy. Returns the warning line, or null.
 * The page marker is checked structurally ("__mochiPage") because importing types.ts here would be a module cycle.
 */
export function csrfBootWarning(options: {
  csrf?: MochiCsrfOptions;
  proxy?: MochiProxyOptions;
  filters?: { 'csrf:check'?: unknown };
  routes?: Record<string, unknown>;
}): string | null {
  if (options.csrf?.checkOrigin === false || options.filters?.['csrf:check'] !== undefined || options.proxy?.origin || options.proxy?.hostHeader) {
    return null;
  }
  const actionRoutes = Object.entries(options.routes ?? {}).filter(([, handler]) => {
    const page = handler as { __mochiPage?: boolean; actions?: Record<string, unknown> } | undefined;
    return page?.__mochiPage === true && page.actions !== undefined && Object.keys(page.actions).length > 0;
  });
  if (actionRoutes.length === 0) {
    return null;
  }
  return `CSRF: ${actionRoutes.length} route(s) declare form actions (e.g. "${actionRoutes[0]?.[0]}") but no proxy.origin or proxy.hostHeader is configured — their form POSTs will be blocked with 403 in production, because the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }) before deploying.`;
}

/**
 * Resolve the framework's default CSRF decision and run it through the `csrf:check` filter, the single override point
 * for extensions. The filter receives that decision — `null` to pass, `Response` to block — and returns the input
 * unchanged to delegate, `null` to bypass, or a fresh `Response` to substitute a custom block.
 */
export function csrfCheck(
  request: Request,
  url: URL,
  csrf: MochiCsrfOptions | undefined,
  proxy: MochiProxyOptions | undefined,
  development: boolean,
  formContentTypes: ReadonlySet<string> = DEFAULT_FORM_CONTENT_TYPES,
  protectedMethods: ReadonlySet<string> = DEFAULT_PROTECTED_METHODS,
  trustedOrigins: ReadonlySet<string> = new Set(csrf?.trustedOrigins ?? []),
): Response | null {
  const defaultDecision = csrfCheckDefault(request, url, csrf, proxy, development, formContentTypes, protectedMethods, trustedOrigins);
  return applyFilter('csrf:check', defaultDecision, { request, url });
}

function csrfCheckDefault(
  request: Request,
  url: URL,
  csrf: MochiCsrfOptions | undefined,
  proxy: MochiProxyOptions | undefined,
  development: boolean,
  formContentTypes: ReadonlySet<string>,
  protectedMethods: ReadonlySet<string>,
  trustedOrigins: ReadonlySet<string>,
): Response | null {
  if (csrf?.checkOrigin === false) {
    return null;
  }
  if (!protectedMethods.has(request.method)) {
    return null;
  }
  if (!isFormContentType(request.headers.get('content-type'), formContentTypes)) {
    return null;
  }

  const expectedOriginConfigured = Boolean(proxy?.origin || proxy?.hostHeader);
  if (!expectedOriginConfigured) {
    return csrfUnconfiguredDecision(request, url, development);
  }

  return csrfOriginMatchDecision(request, url, proxy, development, trustedOrigins);
}

function csrfUnconfiguredDecision(request: Request, url: URL, development: boolean): Response | null {
  if (development) {
    logger.warn(
      `CSRF: ${request.method} ${url.pathname} would be blocked in production: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }) before deploying.`,
    );
    return null;
  }
  const message = `Cross-site ${request.method} form submissions are forbidden`;
  const reason = 'Mochi is running in production mode without proxy.origin or proxy.hostHeader configured.';
  logger.warn(
    `CSRF: blocking ${request.method} ${url.pathname} from origin ${request.headers.get('origin') ?? '<missing>'}: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }).`,
  );
  return csrfForbidden(request, message, reason);
}

function csrfOriginMatchDecision(request: Request, url: URL, proxy: MochiProxyOptions | undefined, development: boolean, trustedOrigins: ReadonlySet<string>): Response | null {
  const expectedOrigin = resolveExpectedOrigin(request, url, proxy);
  const origin = request.headers.get('origin');
  const expectedNormalized = normalizeOrigin(expectedOrigin);
  const originNormalized = origin ? normalizeOrigin(origin) : null;
  if (originNormalized && originNormalized === expectedNormalized) {
    return null;
  }
  if (originNormalized && [...trustedOrigins].some((t) => normalizeOrigin(t) === originNormalized)) {
    return null;
  }

  if (development) {
    logger.warn(
      `CSRF: cross-site ${request.method} ${url.pathname} from origin ${origin ?? '<missing>'} would be blocked in production (allowed: ${expectedOrigin}). Add it to csrf.trustedOrigins or set csrf.checkOrigin: false to allow.`,
    );
    return null;
  }

  logger.warn(
    `CSRF: blocking ${request.method} ${url.pathname} — origin ${origin ?? '<missing>'} does not match expected ${expectedOrigin} (and is not in csrf.trustedOrigins=[${[...trustedOrigins].join(', ') || '<empty>'}]).`,
  );
  const message = `Cross-site ${request.method} form submissions are forbidden`;
  return csrfForbidden(request, message);
}
