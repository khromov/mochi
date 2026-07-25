/**
 * Reverse-proxy trust configuration. When the app sits behind a load balancer,
 * CDN, or tunnel, what Bun sees on the socket isn't the public origin or the
 * real client IP. The options here let the framework derive both from
 * forwarded headers — but **only set them if the proxy is trusted to
 * overwrite those headers**, since clients can spoof them otherwise.
 *
 * - `origin` / `protocolHeader` / `hostHeader` / `portHeader` feed
 *   `resolveExpectedOrigin()`, used by the CSRF check.
 * - `addressHeader` / `xffDepth` feed `getClientAddress()`, exposed on the
 *   request context for application code (rate limiting, audit logs, etc.).
 */

export interface MochiProxyOptions {
  /**
   * Explicit public origin (e.g. `'https://my.site'`). Overrides any header
   * derivation and `url.origin`. Drives `event.url.origin`, internal redirects
   * (e.g. trailing-slash canonicalisation), and the CSRF origin check.
   */
  origin?: string;
  /**
   * Header carrying the request protocol from a trusted reverse proxy
   * (typically `'x-forwarded-proto'`).
   */
  protocolHeader?: string;
  /**
   * Header carrying the request host from a trusted reverse proxy
   * (typically `'x-forwarded-host'`).
   */
  hostHeader?: string;
  /**
   * Header carrying the request port from a trusted reverse proxy
   * (typically `'x-forwarded-port'`). Only needed when the public port
   * differs from the host header's implicit port.
   */
  portHeader?: string;
  /**
   * Header carrying the client IP from a trusted reverse proxy
   * (e.g. `'true-client-ip'`, `'x-forwarded-for'`). When unset,
   * `getClientAddress()` falls back to Bun's connecting remote IP.
   */
  addressHeader?: string;
  /**
   * Number of trusted proxies in front of the server when `addressHeader`
   * is `'x-forwarded-for'`. The header is comma-separated; reading from the
   * right at depth `N` skips `N - 1` trusted proxies. Defaults to `1`
   * (rightmost entry — the last trusted proxy's view of the client).
   *
   * Example: with `client, proxy1, proxy2` and `xffDepth: 3`, the client
   * address is `client`. With `xffDepth: 1` it's `proxy2`.
   *
   * Reading from the right blocks spoofing: a client appending its own
   * `X-Forwarded-For` header gets pushed leftward by each trusted proxy.
   */
  xffDepth?: number;
  /**
   * Header carrying a per-request correlation id from a trusted reverse
   * proxy (typically `'x-request-id'`). When set and present on the inbound
   * request, the value seeds `getRequestContext().requestId` and rides on
   * every lifecycle event for that request. When absent (or unset here),
   * the framework generates its own id with `Bun.randomUUIDv7()`.
   *
   * Leave unset on the public internet — clients can spoof any header, and
   * a colliding id will smear log lines for unrelated requests together.
   * Only enable behind a proxy you control that overwrites the header.
   */
  requestIdHeader?: string;
}

export class ProxyHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyHeaderError';
  }
}

function assertHeaderName(value: string, option: string): void {
  try {
    const headers = new Headers();
    headers.set(value, '1');
  } catch {
    throw new TypeError(`Mochi.serve({ proxy.${option} }): ${JSON.stringify(value)} is not a valid HTTP header name.`);
  }
}

/**
 * Parse an HTTP(S) origin into the canonical serialization browsers use for
 * the Origin header. Credentials, paths, query strings, and fragments are not
 * valid origin configuration and are rejected.
 */
export function normalizeHttpOrigin(value: string, label = 'origin'): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) origin; received ${JSON.stringify(value)}.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${label} must use http or https; received ${JSON.stringify(value)}.`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError(`${label} must not contain credentials, a path, query, or fragment; received ${JSON.stringify(value)}.`);
  }
  return url.origin;
}

/** Validate static proxy configuration before the server binds. */
export function validateProxyOptions(options: MochiProxyOptions | undefined): void {
  if (!options) {
    return;
  }
  if (options.origin !== undefined) {
    normalizeHttpOrigin(options.origin, 'Mochi.serve({ proxy.origin })');
  }
  for (const [key, value] of [
    ['protocolHeader', options.protocolHeader],
    ['hostHeader', options.hostHeader],
    ['portHeader', options.portHeader],
    ['addressHeader', options.addressHeader],
    ['requestIdHeader', options.requestIdHeader],
  ] as const) {
    if (value !== undefined) {
      assertHeaderName(value, key);
    }
  }
  if (options.xffDepth !== undefined && (!Number.isInteger(options.xffDepth) || options.xffDepth < 1)) {
    throw new TypeError(`Mochi.serve({ proxy.xffDepth }): expected a positive integer, received ${String(options.xffDepth)}.`);
  }
}

function singleForwardedValue(value: string | null, header: string): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(',')) {
    throw new ProxyHeaderError(`Invalid ${header} proxy header.`);
  }
  return trimmed;
}

/**
 * Builds the public-facing URL for the request, applying any trusted-proxy
 * origin override. When proxy options aren't configured, returns
 * `new URL(req.url)` unchanged. Used by every per-request handler in
 * `Mochi.ts` so `event.url`, internal redirects, and the CSRF check all see
 * the public origin under a TLS-terminating reverse proxy.
 */
export function buildPublicUrl(request: Request, options: MochiProxyOptions | undefined): URL {
  const url = new URL(request.url);
  const origin = resolveExpectedOrigin(request, url, options);
  if (origin === url.origin) {
    return url;
  }
  return new URL(url.pathname + url.search + url.hash, origin);
}

export function resolveExpectedOrigin(request: Request, url: URL, options: MochiProxyOptions | undefined): string {
  if (options?.origin) {
    return normalizeHttpOrigin(options.origin, 'Mochi.serve({ proxy.origin })');
  }

  const protocolHeader = options?.protocolHeader;
  const hostHeader = options?.hostHeader;
  const portHeader = options?.portHeader;

  if (!protocolHeader && !hostHeader && !portHeader) {
    return url.origin;
  }

  const protocol = singleForwardedValue(protocolHeader ? request.headers.get(protocolHeader) : null, protocolHeader ?? 'protocol') ?? url.protocol.replace(/:$/, '');
  const rawHost = singleForwardedValue(hostHeader ? request.headers.get(hostHeader) : null, hostHeader ?? 'host') ?? url.host;
  const forwardedPort = singleForwardedValue(portHeader ? request.headers.get(portHeader) : null, portHeader ?? 'port');

  if (protocol !== 'http' && protocol !== 'https') {
    throw new ProxyHeaderError(`Invalid ${protocolHeader ?? 'protocol'} proxy header.`);
  }

  let publicUrl: URL;
  try {
    publicUrl = new URL(`${protocol}://${rawHost}`);
  } catch {
    throw new ProxyHeaderError(`Invalid ${hostHeader ?? 'host'} proxy header.`);
  }
  if (publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
    throw new ProxyHeaderError(`Invalid ${hostHeader ?? 'host'} proxy header.`);
  }

  if (forwardedPort !== null) {
    if (!/^\d{1,5}$/.test(forwardedPort)) {
      throw new ProxyHeaderError(`Invalid ${portHeader ?? 'port'} proxy header.`);
    }
    const port = Number(forwardedPort);
    if (port < 1 || port > 65_535) {
      throw new ProxyHeaderError(`Invalid ${portHeader ?? 'port'} proxy header.`);
    }
    publicUrl.port = String(port);
  }

  return publicUrl.origin;
}

export function getClientAddress(request: Request, fallback: string | null, options: MochiProxyOptions | undefined): string | null {
  const addressHeader = options?.addressHeader;
  if (!addressHeader) {
    return fallback;
  }

  const value = request.headers.get(addressHeader);
  if (!value) {
    return fallback;
  }

  if (addressHeader.toLowerCase() === 'x-forwarded-for') {
    const ips = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ips.length === 0) {
      return fallback;
    }
    const depth = options?.xffDepth ?? 1;
    // A misconfigured `xffDepth` larger than the chain must never surrender to
    // the leftmost entry — that one is fully client-controlled and spoofable.
    // Fall back to the rightmost (closest-proxy) entry instead.
    return ips[ips.length - depth] ?? ips[ips.length - 1]!;
  }

  return value.trim() || fallback;
}
