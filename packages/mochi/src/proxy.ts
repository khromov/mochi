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

// TODO: Let's review this an extra time for security before finalizing the API.
export function resolveExpectedOrigin(request: Request, url: URL, options: MochiProxyOptions | undefined): string {
  if (options?.origin) {
    return options.origin;
  }

  const protocolHeader = options?.protocolHeader;
  const hostHeader = options?.hostHeader;
  const portHeader = options?.portHeader;

  if (!protocolHeader && !hostHeader && !portHeader) {
    return url.origin;
  }

  const protocolFromHeader = protocolHeader ? request.headers.get(protocolHeader) : null;
  const hostFromHeader = hostHeader ? request.headers.get(hostHeader) : null;
  const portFromHeader = portHeader ? request.headers.get(portHeader) : null;

  const protocol = (protocolFromHeader ?? url.protocol.replace(/:$/, '')).trim();
  const rawHost = (hostFromHeader ?? url.host).trim();

  // If a port header is set, replace any port already on the host.
  const hostNoPort = rawHost.includes(':') ? rawHost.slice(0, rawHost.indexOf(':')) : rawHost;
  const host = portFromHeader ? `${hostNoPort}:${portFromHeader.trim()}` : rawHost;

  return `${protocol}://${host}`;
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
    return ips[ips.length - depth] ?? ips[0]!;
  }

  return value.trim() || fallback;
}
