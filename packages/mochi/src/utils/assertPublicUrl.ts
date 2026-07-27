import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

/**
 * Defense-in-depth guard for outbound fetches against user-supplied URLs: validate the host against an optional
 * allowlist and reject hosts resolving to private, loopback, link-local, or reserved addresses. DNS-rebinding stays
 * partly open, since the IP is resolved here and re-resolved by `fetch`, so an encrypted, authenticated payload remains
 * the primary protection for callers that have one.
 */
export interface UrlGuardOptions {
  allowedHosts?: string[] | undefined;
  blockPrivateNetworks?: boolean;
}

/** Thrown for every rejection so callers can map it to their own error type. */
export class SsrfGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfGuardError';
  }
}

function hostMatches(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const pat = pattern.toLowerCase();
  if (pat.startsWith('*.')) {
    const suffix = pat.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pat;
}

// URL.hostname keeps the brackets on IPv6 literals ('[::1]'), which isIP()
// doesn't recognize — strip them so literals take the direct-check path.
function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

// ipaddr.js classifies private, loopback, link-local, unique-local, multicast, reserved, and every IPv6 transition
// range (6to4, NAT64/rfc6052, rfc6145, teredo, ipv4-mapped) as non-'unicast', so one `range()` check covers them all.
function isBlockedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(ip); // folds ::ffff:a.b.c.d down to its IPv4 form
  } catch {
    return true; // unparseable → fail closed
  }
  if (addr.kind() === 'ipv6') {
    const g = (addr as ipaddr.IPv6).parts;
    // Deprecated IPv4-compatible ::/96 (e.g. ::7f00:1 = ::127.0.0.1): ipaddr.js
    // scores these 'unicast', so block the whole ::/96 block outright — it also
    // covers :: (unspecified) and ::1 (loopback).
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return true;
    }
  }
  return addr.range() !== 'unicast';
}

export async function assertPublicUrl(src: string, opts: UrlGuardOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    throw new SsrfGuardError('Invalid source URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfGuardError('Source protocol must be http or https');
  }

  if (opts.allowedHosts && opts.allowedHosts.length > 0) {
    if (!opts.allowedHosts.some((p) => hostMatches(url.hostname, p))) {
      throw new SsrfGuardError('Source host is not in the allowlist');
    }
  }

  if (opts.blockPrivateNetworks) {
    if (url.hostname.toLowerCase() === 'localhost') {
      throw new SsrfGuardError('Source host resolves to a private address');
    }
    const host = stripBrackets(url.hostname);
    let addresses: string[];
    if (isIP(host)) {
      addresses = [host];
    } else {
      try {
        const results = await lookup(host, { all: true });
        addresses = results.map((r) => r.address);
      } catch {
        throw new SsrfGuardError('Could not resolve source host');
      }
    }
    if (addresses.length === 0 || addresses.some(isBlockedIp)) {
      throw new SsrfGuardError('Source host resolves to a private address');
    }
  }

  return url;
}
