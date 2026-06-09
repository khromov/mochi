/**
 * Origin-header CSRF protection for non-preflighted POSTs (and other
 * state-mutating verbs). Modeled on SvelteKit's built-in check: a cross-origin
 * request reaches the server without a CORS preflight only when its
 * Content-Type is `application/x-www-form-urlencoded`, `multipart/form-data`,
 * `text/plain`, OR is missing entirely — those are the cases worth gating.
 * Browsers always send `Origin` on non-GET cross-origin requests, so comparing
 * it to the expected origin blocks the attack.
 *
 * Safe by default: in production, the check refuses every protected form
 * submission until `proxy.origin` (or `proxy.hostHeader`) is configured, so
 * the framework knows what origin to trust. In development the same
 * misconfiguration is allowed through with a `logger.warn` line so local work
 * isn't blocked.
 *
 * Callers must pass `development` explicitly so prod-vs-dev intent is never
 * implicit. In development the check never blocks: a failure logs a
 * `logger.warn` line noting the request would be rejected in production.
 *
 * Limitations:
 * - Some legacy clients / privacy proxies strip `Origin`. They will be
 *   rejected; allow-list them via `trustedOrigins` if needed.
 * - JSON/octet-stream endpoints (`Mochi.api(...)`) are not checked because the
 *   browser already requires a CORS preflight to send those cross-origin.
 */

import { applyFilter } from './extensions';
import { logger } from './log';
import { resolveExpectedOrigin, type MochiProxyOptions } from './proxy';

/**
 * Default content types that gate the CSRF check. These are the three types a
 * cross-origin `<form>` can submit without a CORS preflight (per WHATWG).
 * Override with the `csrf:formContentTypes` filter on `Mochi.serve()`.
 */
export const DEFAULT_FORM_CONTENT_TYPES: ReadonlySet<string> = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);

/**
 * Default HTTP methods the CSRF check applies to (everything that can mutate
 * server state from a `<form>`). Override with `csrf:protectedMethods`.
 */
export const DEFAULT_PROTECTED_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface MochiCsrfOptions {
  /** Compare `Origin` header against the resolved expected origin. Defaults to `true`. */
  checkOrigin?: boolean;
  /** Origins to allow even when they don't match the expected origin. */
  trustedOrigins?: string[];
}

/**
 * Strip default ports (`:443` for https, `:80` for http) from an origin string.
 * Browsers omit them in the `Origin` header, but a reverse proxy's
 * `x-forwarded-host` may include them — without this, `https://foo.com:443`
 * (configured) wouldn't match `https://foo.com` (sent). Anything else passes
 * through unchanged so we don't accidentally rewrite hostnames or other parts.
 */
function normalizeOrigin(value: string): string {
  if (value.startsWith('https://')) {
    return value.replace(/:443$/, '');
  }
  if (value.startsWith('http://')) {
    return value.replace(/:80$/, '');
  }
  return value;
}

/**
 * Build the canonical 403 response for a blocked CSRF submission, content-
 * negotiated against `Accept`. Pass `reason` to attach an extra explanation
 * (used when the misconfiguration is the framework's own, not the request's).
 */
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
 * Why a block was decided, so callers can build their own response and log line.
 * `unconfigured` — no expected origin is configured, so nothing can be trusted.
 * `mismatch` — the request's `Origin` is neither the expected origin nor trusted.
 */
export type OriginBlock = { kind: 'unconfigured'; origin: string | null } | { kind: 'mismatch'; origin: string | null; expectedOrigin: string };

/**
 * Shared Origin-comparison core for both the CSRF check (form POSTs) and the
 * WebSocket upgrade check. Returns `null` when the request's `Origin` is trusted
 * (allow), or an `OriginBlock` describing why it should be rejected. The two
 * callers diverge on how a block becomes a response and what they log — form
 * submissions and socket upgrades differ in both — so that stays out here.
 */
export function evaluateOrigin(request: Request, url: URL, proxy: MochiProxyOptions | undefined, trustedOrigins: ReadonlySet<string>): OriginBlock | null {
  const expectedOriginConfigured = Boolean(proxy?.origin || proxy?.hostHeader);
  if (!expectedOriginConfigured) {
    return { kind: 'unconfigured', origin: request.headers.get('origin') };
  }

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
  return { kind: 'mismatch', origin, expectedOrigin };
}

/**
 * Origin check for WebSocket upgrades. Browsers send `Origin` on the upgrade
 * request, but — unlike `fetch` — the same-origin policy does not stop a page on
 * another site from opening a socket to this server. Without this check any
 * origin can connect and ride the visitor's cookies (Cross-Site WebSocket
 * Hijacking). Mirrors the CSRF model: safe by default in production (rejects
 * until `proxy.origin`/`proxy.hostHeader` is configured), warns and allows in
 * development. Bypass with `csrf.checkOrigin === false` or `csrf.trustedOrigins`.
 *
 * Returns a 403 `Response` to reject the upgrade, or `null` to allow it.
 */
export function checkWsOrigin(
  request: Request,
  url: URL,
  csrf: MochiCsrfOptions | undefined,
  proxy: MochiProxyOptions | undefined,
  development: boolean,
  trustedOrigins: ReadonlySet<string> = new Set(csrf?.trustedOrigins ?? []),
): Response | null {
  if (csrf?.checkOrigin === false) {
    return null;
  }

  const block = evaluateOrigin(request, url, proxy, trustedOrigins);
  if (!block) {
    return null;
  }

  const forbidden = (): Response => new Response('WebSocket upgrade forbidden', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  if (block.kind === 'unconfigured') {
    if (development) {
      logger.warn(
        `CSRF: WebSocket upgrade ${url.pathname} would be blocked in production: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }) before deploying.`,
      );
      return null;
    }
    logger.warn(
      `CSRF: blocking WebSocket upgrade ${url.pathname} from origin ${block.origin ?? '<missing>'}: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }).`,
    );
    return forbidden();
  }

  if (development) {
    logger.warn(
      `CSRF: cross-site WebSocket upgrade ${url.pathname} from origin ${block.origin ?? '<missing>'} would be blocked in production (allowed: ${block.expectedOrigin}). Add it to csrf.trustedOrigins or set csrf.checkOrigin: false to allow.`,
    );
    return null;
  }

  logger.warn(
    `CSRF: blocking WebSocket upgrade ${url.pathname} — origin ${block.origin ?? '<missing>'} does not match expected ${block.expectedOrigin} (and is not in csrf.trustedOrigins=[${[...trustedOrigins].join(', ') || '<empty>'}]).`,
  );
  return forbidden();
}

/**
 * Resolve the framework's default CSRF decision and run it through the
 * `csrf:check` filter, giving extensions a single override point. The filter
 * receives the default decision (`null` to pass, `Response` to block); return
 * the input unchanged to delegate to the framework, `null` to bypass, or a
 * fresh `Response` to substitute a custom block.
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

  const block = evaluateOrigin(request, url, proxy, trustedOrigins);
  if (!block) {
    return null;
  }

  if (block.kind === 'unconfigured') {
    if (development) {
      logger.warn(
        `CSRF: ${request.method} ${url.pathname} would be blocked in production: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }) before deploying.`,
      );
      return null;
    }
    const message = `Cross-site ${request.method} form submissions are forbidden`;
    const reason = 'Mochi is running in production mode without proxy.origin or proxy.hostHeader configured.';
    logger.warn(
      `CSRF: blocking ${request.method} ${url.pathname} from origin ${block.origin ?? '<missing>'}: no proxy.origin or proxy.hostHeader configured, so the expected origin can't be trusted. Set Mochi.serve({ proxy: { origin: '...' } }).`,
    );
    return csrfForbidden(request, message, reason);
  }

  if (development) {
    logger.warn(
      `CSRF: cross-site ${request.method} ${url.pathname} from origin ${block.origin ?? '<missing>'} would be blocked in production (allowed: ${block.expectedOrigin}). Add it to csrf.trustedOrigins or set csrf.checkOrigin: false to allow.`,
    );
    return null;
  }

  logger.warn(
    `CSRF: blocking ${request.method} ${url.pathname} — origin ${block.origin ?? '<missing>'} does not match expected ${block.expectedOrigin} (and is not in csrf.trustedOrigins=[${[...trustedOrigins].join(', ') || '<empty>'}]).`,
  );
  const message = `Cross-site ${request.method} form submissions are forbidden`;
  return csrfForbidden(request, message);
}
