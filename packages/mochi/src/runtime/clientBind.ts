import { createHash, timingSafeEqual } from 'node:crypto';
import ipaddr from 'ipaddr.js';

export type MochiClientBindOptions = boolean | { network?: boolean; headers?: string[] };

export interface ResolvedBindOptions {
  network: boolean;
  /** Lowercased, deduped, sorted — reordering the configured list never invalidates outstanding tokens. */
  headers: string[];
}

/** Headers a browser sends identically on every request kind, unlike client hints, which are absent on subresource fetches. */
export const DEFAULT_BIND_HEADERS = ['accept-language', 'user-agent'];

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function resolveBindOptions(input: MochiClientBindOptions | undefined, defaultOn: boolean, label: string): ResolvedBindOptions {
  if (input === false || (input === undefined && !defaultOn)) {
    return { network: false, headers: [] };
  }
  if (input === true || input === undefined) {
    return { network: true, headers: [...DEFAULT_BIND_HEADERS] };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label}: bind must be a boolean or an object with network/headers, got ${JSON.stringify(input)}`);
  }
  if (input.network !== undefined && typeof input.network !== 'boolean') {
    throw new Error(`${label}: bind.network must be a boolean, got ${JSON.stringify(input.network)}`);
  }
  const rawHeaders = input.headers ?? DEFAULT_BIND_HEADERS;
  if (!Array.isArray(rawHeaders) || rawHeaders.some((h) => typeof h !== 'string')) {
    throw new Error(`${label}: bind.headers must be an array of header names`);
  }
  for (const h of rawHeaders) {
    if (!HEADER_TOKEN.test(h)) {
      throw new Error(`${label}: bind.headers contains an invalid header name ${JSON.stringify(h)}`);
    }
  }
  const headers = [...new Set(rawHeaders.map((h) => h.toLowerCase()))].sort();
  return { network: input.network ?? true, headers };
}

export function bindActive(bind: ResolvedBindOptions): boolean {
  return bind.network || bind.headers.length > 0;
}

export interface ClientBindHashes {
  /** Network-prefix hash. */
  ph: string;
  /** Header hash. */
  hh: string;
  /** Bound address family; 0 = no resolvable address. */
  f: 4 | 6 | 0;
}

// NUL-delimited so distinct part lists can't collide by concatenation; 16 bytes suffice for
// equality checks on values sealed inside an authenticated token.
function hashParts(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16).toString('base64url');
}

/**
 * A /24 for IPv4 and a /64 for IPv6: wide enough to tolerate egress rotation inside CGNAT pools, mobile
 * carriers, and IPv6 privacy extensions, narrow enough that a token doesn't travel between networks.
 */
function networkPrefix(address: string | null): { prefix: string; f: 4 | 6 | 0 } {
  if (address) {
    try {
      // process() folds ::ffff:a.b.c.d down to IPv4, which Bun's requestIP emits on dual-stack listeners.
      const addr = ipaddr.process(address);
      if (addr.kind() === 'ipv4') {
        return { prefix: (addr as ipaddr.IPv4).octets.slice(0, 3).join('.') + '.0/24', f: 4 };
      }
      const groups = (addr as ipaddr.IPv6).parts.slice(0, 4).map((p) => p.toString(16));
      return { prefix: groups.join(':') + '::/64', f: 6 };
    } catch {
      // unparseable → the fixed no-address marker below
    }
  }
  return { prefix: 'no-address', f: 0 };
}

export function computeBindHashes(inputs: { address: string | null; headers: Headers }, bind: ResolvedBindOptions): ClientBindHashes | null {
  if (!bindActive(bind)) {
    return null;
  }
  const { prefix, f } = networkPrefix(inputs.address);
  const headerParts: string[] = ['mochi-bind-hdr-v1'];
  for (const name of bind.headers) {
    headerParts.push(name, inputs.headers.get(name) ?? '');
  }
  return {
    ph: hashParts(['mochi-bind-net-v1', String(f), prefix]),
    hh: hashParts(headerParts),
    f,
  };
}

export function bindHashEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
