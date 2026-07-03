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

// TODO: This and similar functions should be moved to separate utils or use a
// off the shelf library rather than reimplementing the wheel.
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

// Expand an IPv6 literal into its eight 16-bit groups, resolving `::` and any
// trailing dotted-quad IPv4 embedding. Returns null for anything unparseable.
function expandIpv6(addr: string): number[] | null {
  let s = addr;
  // Fold a trailing dotted IPv4 (e.g. ::ffff:127.0.0.1) into two hextets so the
  // hex and dotted spellings of the same address normalize identically.
  const dotted = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const octets = dotted.slice(1, 5).map(Number);
    if (octets.some((n) => n > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    s = s.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }

  const parseGroups = (part: string): number[] | null => {
    if (part === '') {
      return [];
    }
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) {
        return null;
      }
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const halves = s.split('::');
  if (halves.length > 2) {
    return null;
  }
  if (halves.length === 2) {
    const head = parseGroups(halves[0] ?? '');
    const tail = parseGroups(halves[1] ?? '');
    if (!head || !tail) {
      return null;
    }
    const missing = 8 - head.length - tail.length;
    if (missing < 0) {
      return null;
    }
    return [...head, ...Array<number>(missing).fill(0), ...tail];
  }
  const groups = parseGroups(s);
  return groups && groups.length === 8 ? groups : null;
}

function groupsToIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

// Recover the embedded IPv4 from the standard IPv6→IPv4 transition ranges, so a
// loopback/private IPv4 can't tunnel past the guard in IPv6 clothing.
function embeddedIpv4(g: number[]): string | null {
  const top96Zero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  if (top96Zero && g[5] === 0xffff) {
    return groupsToIpv4(g[6]!, g[7]!); // IPv4-mapped ::ffff:0:0/96
  }
  if (top96Zero && g[5] === 0) {
    return groupsToIpv4(g[6]!, g[7]!); // IPv4-compatible ::/96 (deprecated)
  }
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return groupsToIpv4(g[6]!, g[7]!); // NAT64 64:ff9b::/96
  }
  if (g[0] === 0x2002) {
    return groupsToIpv4(g[1]!, g[2]!); // 6to4 2002::/16
  }
  return null;
}

function ipv6IsPrivate(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] ?? ''; // strip zone id
  const g = expandIpv6(addr);
  if (!g) {
    return true; // unparseable → reject (fail closed)
  }
  // loopback ::1 and unspecified ::
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) {
    return true;
  }
  if ((g[0]! & 0xffc0) === 0xfe80) {
    return true; // link-local fe80::/10
  }
  if ((g[0]! & 0xfe00) === 0xfc00) {
    return true; // unique-local fc00::/7
  }
  const v4 = embeddedIpv4(g);
  if (v4 && ipv4IsPrivate(v4)) {
    return true;
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
    // URL.hostname keeps the brackets on IPv6 literals ('[::1]'), which isIP()
    // doesn't recognize — strip them so literals take the direct-check path
    // instead of failing a DNS lookup of the bracketed string.
    const host = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname;
    let addresses: string[];
    if (isIP(host)) {
      addresses = [host];
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
