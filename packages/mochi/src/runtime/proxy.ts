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

  return originFromHeaders(request, url, protocolHeader, hostHeader, portHeader);
}

function originFromHeaders(request: Request, url: URL, protocolHeader: string | undefined, hostHeader: string | undefined, portHeader: string | undefined): string {
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
    // An `xffDepth` larger than the chain falls back to the rightmost, closest-proxy entry: the leftmost is fully
    // client-controlled and spoofable.
    return ips[ips.length - depth] ?? ips[ips.length - 1]!;
  }

  return value.trim() || fallback;
}
