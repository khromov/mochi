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

import { applyFilter, hasFilter } from '../extensions';
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

// Why the policy refused, carried out of the pure decision function so the diagnostics can be emitted once the
// `csrf:check` filter has had its say and the *effective* outcome is known.
interface CsrfRejection {
  /** Cause fragment, reused when the filter substitutes a response of its own. */
  reason: string;
  /** Emitted when the framework's own block survives the filter. */
  blocked: string;
  /** Emitted when development leniency lets the request through and nothing else rejected it. */
  wouldBlock: string;
}

interface CsrfOutcome {
  decision: Response | null;
  /** Null when the policy allowed the request outright — nothing to report either way. */
  rejection: CsrfRejection | null;
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
  const { decision, rejection } = csrfCheckDefault(request, url, csrf, proxy, development, formContentTypes, protectedMethods, trustedOrigins);
  const filtered = applyFilter('csrf:check', decision, { request, url });
  warnCsrfDecision(request, url, decision, filtered, rejection, development);
  return filtered;
}

// Diagnostics run on the effective decision, never the default one, so an exemption is never announced as a block.
function warnCsrfDecision(request: Request, url: URL, decision: Response | null, filtered: Response | null, rejection: CsrfRejection | null, development: boolean): void {
  if (filtered) {
    if (filtered === decision && rejection) {
      logger.warn(rejection.blocked);
      return;
    }
    const because = rejection ? ` (${rejection.reason})` : '';
    logger.warn(`CSRF: blocking ${request.method} ${url.pathname} with the ${filtered.status} response returned by the csrf:check filter${because}.`);
    return;
  }
  // A registered filter that returns null is byte-identical to one that delegates the development default of null, so
  // predicting production from here would be a guess — stay quiet and let the app own its own exemption.
  if (development && rejection && !hasFilter('csrf:check')) {
    logger.warn(rejection.wouldBlock);
  }
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
): CsrfOutcome {
  const allow: CsrfOutcome = { decision: null, rejection: null };
  if (csrf?.checkOrigin === false) {
    return allow;
  }
  if (!protectedMethods.has(request.method)) {
    return allow;
  }
  if (!isFormContentType(request.headers.get('content-type'), formContentTypes)) {
    return allow;
  }

  const message = `Cross-site ${request.method} form submissions are forbidden`;
  const expectedOriginConfigured = Boolean(proxy?.origin || proxy?.hostHeader);
  if (!expectedOriginConfigured) {
    const rejection: CsrfRejection = {
      reason: "no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted",
      blocked: `CSRF: blocking ${request.method} ${url.pathname} from origin ${request.headers.get('origin') ?? '<missing>'}: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }).`,
      wouldBlock: `CSRF: ${request.method} ${url.pathname} would be blocked in production: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }) before deploying.`,
    };
    if (development) {
      return { decision: null, rejection };
    }
    const reason = 'Mochi is running in production mode without proxy.origin or proxy.hostHeader configured.';
    return { decision: csrfForbidden(request, message, reason), rejection };
  }

  const expectedOrigin = resolveExpectedOrigin(request, url, proxy);
  const origin = request.headers.get('origin');
  const expectedNormalized = normalizeOrigin(expectedOrigin);
  const originNormalized = origin ? normalizeOrigin(origin) : null;
  if (originNormalized && originNormalized === expectedNormalized) {
    return allow;
  }
  if (originNormalized && [...trustedOrigins].some((t) => normalizeOrigin(t) === originNormalized)) {
    return allow;
  }

  const rejection: CsrfRejection = {
    reason: `origin ${origin ?? '<missing>'} does not match expected ${expectedOrigin}`,
    blocked: `CSRF: blocking ${request.method} ${url.pathname} — origin ${origin ?? '<missing>'} does not match expected ${expectedOrigin} (and is not in csrf.trustedOrigins=[${[...trustedOrigins].join(', ') || '<empty>'}]).`,
    wouldBlock: `CSRF: cross-site ${request.method} ${url.pathname} from origin ${origin ?? '<missing>'} would be blocked in production (allowed: ${expectedOrigin}). Add it to csrf.trustedOrigins or set csrf.checkOrigin: false to allow.`,
  };
  if (development) {
    return { decision: null, rejection };
  }
  return { decision: csrfForbidden(request, message), rejection };
}
