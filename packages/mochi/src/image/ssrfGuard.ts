import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { ImageError } from './types';

/**
 * Defense-in-depth beyond the encrypted URL payload: validate the source host
 * against an optional allowlist and reject sources that resolve to private/
 * loopback/link-local addresses. Note this does not fully close DNS-rebinding
 * (the IP is resolved here, then re-resolved by `fetch`) — the encrypted,
 * authenticated payload remains the primary protection.
 */
export interface SsrfGuardOptions {
  allowedHosts: string[] | undefined;
  blockPrivateNetworks: boolean;
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

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  } // this-network, private, loopback
  if (a === 169 && b === 254) {
    return true;
  } // link-local
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  } // private
  if (a === 192 && b === 168) {
    return true;
  } // private
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  } // CGNAT
  if (a >= 224) {
    return true;
  } // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] ?? ''; // strip zone id
  if (addr === '::1' || addr === '::') {
    return true;
  } // loopback / unspecified
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true;
  } // link-local fe80::/10
  if (addr.startsWith('fc') || addr.startsWith('fd')) {
    return true;
  } // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d)
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return ipv4IsPrivate(mapped[1] ?? '');
  }
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    return ipv4IsPrivate(ip);
  }
  if (kind === 6) {
    return ipv6IsPrivate(ip);
  }
  return true; // not a recognizable IP → reject
}

export async function assertAllowedSource(src: string, opts: SsrfGuardOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    throw new ImageError(400, 'Invalid source URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageError(400, 'Source protocol must be http or https');
  }

  if (opts.allowedHosts && opts.allowedHosts.length > 0) {
    if (!opts.allowedHosts.some((p) => hostMatches(url.hostname, p))) {
      throw new ImageError(400, 'Source host is not in the allowlist');
    }
  }

  if (opts.blockPrivateNetworks) {
    if (url.hostname.toLowerCase() === 'localhost') {
      throw new ImageError(400, 'Source host resolves to a private address');
    }
    let addresses: string[];
    if (isIP(url.hostname)) {
      addresses = [url.hostname];
    } else {
      try {
        const results = await lookup(url.hostname, { all: true });
        addresses = results.map((r) => r.address);
      } catch {
        throw new ImageError(400, 'Could not resolve source host');
      }
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new ImageError(400, 'Source host resolves to a private address');
    }
  }

  return url;
}
