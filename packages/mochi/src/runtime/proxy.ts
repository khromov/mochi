/**
 * Reverse-proxy trust configuration. Behind a load balancer, CDN, or tunnel, what Bun sees on the socket is neither the
 * public origin nor the real client IP, so these options derive both from forwarded headers — **set them only if the
 * proxy is trusted to overwrite those headers**, since clients can otherwise spoof them.
 *
 * - `origin` / `protocolHeader` / `hostHeader` / `portHeader` feed
 *   `resolveExpectedOrigin()`, used by the CSRF check.
 * - `addressHeader` / `xffDepth` feed `getClientAddress()`, exposed on the
 *   request context for rate limiting, audit logs, and the like.
 */

export interface MochiProxyOptions {
  /**
   * Explicit public origin (e.g. `'https://my.site'`), overriding header derivation and `url.origin`.
   * Drives `event.url.origin`, internal redirects such as trailing-slash canonicalisation, and the CSRF origin check.
   */
  origin?: string;
  /** Header carrying the request protocol, typically `'x-forwarded-proto'`. */
  protocolHeader?: string;
  /** Header carrying the request host, typically `'x-forwarded-host'`. */
  hostHeader?: string;
  /** Header carrying the request port, typically `'x-forwarded-port'`. Needed only when the public port differs from the host header's implicit one. */
  portHeader?: string;
  /** Header carrying the client IP (e.g. `'true-client-ip'`, `'x-forwarded-for'`); when unset, `getClientAddress()` uses Bun's connecting remote IP. */
  addressHeader?: string;
  /**
   * Number of trusted proxies in front of the server when `addressHeader` is `'x-forwarded-for'`. The header is
   * comma-separated, and reading from the right at depth `N` skips `N - 1` trusted proxies; defaults to `1`, the
   * rightmost entry. Given `client, proxy1, proxy2`, `xffDepth: 3` yields `client` and `xffDepth: 1` yields `proxy2`.
   * Reading from the right blocks spoofing, since each trusted proxy pushes a client-appended header leftward.
   */
  xffDepth?: number;
  /**
   * Header carrying a per-request correlation id, typically `'x-request-id'`. When set and present on the inbound
   * request it seeds `getRequestContext().requestId` and rides every lifecycle event; otherwise the framework generates
   * one with `Bun.randomUUIDv7()`. Enable it only behind a proxy you control that overwrites the header — clients can
   * spoof any header, and a colliding id smears log lines for unrelated requests together.
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
 * Builds the public-facing URL for the request, applying any trusted-proxy origin override and otherwise returning
 * `new URL(req.url)`. Every per-request handler in `Mochi.ts` uses it, so `event.url`, internal redirects, and the CSRF
 * check all see the public origin under a TLS-terminating reverse proxy.
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
    // An `xffDepth` larger than the chain falls back to the rightmost, closest-proxy entry: the leftmost is fully
    // client-controlled and spoofable.
    return ips[ips.length - depth] ?? ips[ips.length - 1]!;
  }

  return value.trim() || fallback;
}
