import type { MochiCompressionDictionaryOptions } from '../types';

/** The `dcz` frame prefix from RFC 9842: a zstd skippable-frame header carrying the 32-byte dictionary hash. */
export const DCZ_MAGIC = Uint8Array.of(0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00);

const SHA256_BYTES = 32;

/** A dictionary registered for Compression Dictionary Transport. */
export interface DictionaryEntry {
  bytes: Uint8Array<ArrayBuffer>;
  /** Raw SHA-256 of `bytes` — what clients echo in `Available-Dictionary`. */
  hash: Uint8Array<ArrayBuffer>;
  hashHex: string;
  id?: string;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Parse an `Available-Dictionary` request header — an RFC 8941 byte sequence (`:base64:`).
 * Strict: anything that isn't exactly one well-formed 32-byte hash returns `null`.
 */
export function parseAvailableDictionary(value: string | null): Uint8Array | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || !trimmed.startsWith(':') || !trimmed.endsWith(':')) {
    return null;
  }
  const b64 = trimmed.slice(1, -1);
  if (b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
    return null;
  }
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  return bytes.length === SHA256_BYTES ? bytes : null;
}

/** Parse a `Dictionary-ID` request header (RFC 8941 string). Informational only — the hash stays authoritative. */
export function parseDictionaryId(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return null;
  }
  return trimmed.slice(1, -1).replace(/\\(.)/g, '$1');
}

function sfString(value: string): string {
  return `"${value.replace(/([\\"])/g, '\\$1')}"`;
}

/** Format a `Use-As-Dictionary` response header (RFC 9842 §2.1). */
export function formatUseAsDictionary(opts: { match: string; matchDest?: string[]; id?: string }): string {
  let out = `match=${sfString(opts.match)}`;
  if (opts.matchDest && opts.matchDest.length > 0) {
    out += `, match-dest=(${opts.matchDest.map(sfString).join(' ')})`;
  }
  if (opts.id) {
    out += `, id=${sfString(opts.id)}`;
  }
  return out;
}

/** Prefix a dictionary-compressed zstd stream with the `dcz` magic + dictionary hash. */
export function frameDcz(zstdStream: Uint8Array, dictionaryHash: Uint8Array): Uint8Array<ArrayBuffer> {
  if (dictionaryHash.length !== SHA256_BYTES) {
    throw new Error(`[mochi] dcz dictionary hash must be ${SHA256_BYTES} bytes, got ${dictionaryHash.length}`);
  }
  const out = new Uint8Array(DCZ_MAGIC.length + SHA256_BYTES + zstdStream.length);
  out.set(DCZ_MAGIC, 0);
  out.set(dictionaryHash, DCZ_MAGIC.length);
  out.set(zstdStream, DCZ_MAGIC.length + SHA256_BYTES);
  return out;
}

function sha256(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return new Uint8Array(hasher.digest());
}

/** Registered dictionaries, looked up by the hash a client presents in `Available-Dictionary`. */
export class DictionaryStore {
  private byHex = new Map<string, DictionaryEntry>();
  /** The entry pages advertise. A client may still hold an older one, which `match()` keeps serving. */
  current: DictionaryEntry | null = null;

  add(bytes: Uint8Array<ArrayBuffer>, opts?: { id?: string }): DictionaryEntry {
    const hash = sha256(bytes);
    const entry: DictionaryEntry = { bytes, hash, hashHex: Buffer.from(hash).toString('hex'), ...(opts?.id ? { id: opts.id } : {}) };
    this.byHex.set(entry.hashHex, entry);
    this.current = entry;
    return entry;
  }

  getByHex(hex: string): DictionaryEntry | undefined {
    return this.byHex.get(hex.toLowerCase());
  }

  match(availableDictionaryHeader: string | null): DictionaryEntry | null {
    const hash = parseAvailableDictionary(availableDictionaryHeader);
    return hash ? (this.byHex.get(Buffer.from(hash).toString('hex')) ?? null) : null;
  }
}

type DczCodec = Pick<typeof import('@bokuweb/zstd-wasm'), 'createCCtx' | 'freeCCtx' | 'compressUsingDict'>;

let codecPromise: Promise<DczCodec> | null = null;

// Loaded lazily so the wasm module (and its ~1 MB instantiation) costs nothing unless the feature is enabled.
export function loadDczCodec(): Promise<DczCodec> {
  codecPromise ??= (async () => {
    const zstd = await import('@bokuweb/zstd-wasm');
    await zstd.init();
    return zstd;
  })();
  return codecPromise;
}

/**
 * Whether `Accept-Encoding` explicitly lists `dcz` with a non-zero q. RFC 9842 clients advertise dictionary encodings
 * only when they hold a matching dictionary, so `*` must never select dcz — hence no generic negotiator here.
 */
export function acceptsDcz(acceptEncoding: string): boolean {
  for (const part of acceptEncoding.split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (name?.trim().toLowerCase() !== 'dcz') {
      continue;
    }
    for (const param of params) {
      const [key, value] = param.split('=');
      if (key?.trim().toLowerCase() === 'q' && parseFloat(value ?? '') === 0) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export const DEFAULT_ZSTD_LEVEL = 10;
export const DEFAULT_MAX_DICTIONARY_BYTES = 262144;

/** Compress `payload` against a registered dictionary and frame it as `dcz`. */
export async function encodeDcz(payload: Uint8Array, entry: DictionaryEntry, level: number = DEFAULT_ZSTD_LEVEL): Promise<Uint8Array<ArrayBuffer>> {
  const codec = await loadDczCodec();
  // A fresh context per call: the lib's `init()` re-instantiates the wasm heap, so a long-cached cctx can dangle.
  const cctx = codec.createCCtx();
  try {
    return frameDcz(codec.compressUsingDict(cctx, payload, entry.bytes, level), entry.hash);
  } finally {
    codec.freeCCtx(cctx);
  }
}

/**
 * Join harvested pages into dictionary bytes, dropping any page that would push the total past `maxBytes` — a
 * whole-page skip keeps the dictionary deterministic where a mid-page truncation would not. Returns the dropped
 * indices so the caller can name the routes it skipped.
 */
export function buildDictionaryBytes(pages: string[], maxBytes: number): { bytes: Uint8Array<ArrayBuffer>; skipped: number[] } {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const skipped: number[] = [];
  let total = 0;
  for (const [index, page] of pages.entries()) {
    const encoded = encoder.encode(page);
    const separator = parts.length > 0 ? 1 : 0;
    if (total + separator + encoded.length > maxBytes) {
      skipped.push(index);
      continue;
    }
    if (separator) {
      parts.push(Uint8Array.of(0x0a));
    }
    parts.push(encoded);
    total += separator + encoded.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, skipped };
}

export interface ResolvedCompressionDictionary {
  /** Static page patterns to harvest, or `null` for every warmable page route. */
  routes: string[] | null;
  maxDictionaryBytes: number;
  zstdLevel: number;
  /** Serve path of the dictionary route, `${assetPrefix}/dictionary`; the hash is appended per entry. */
  dictionaryPath: string;
}

/** Boolean `true` enables in production only, mirroring `warmup` — dev HTML churns too fast for a boot-built dictionary to pay off. */
export function resolveCompressionDictionary(
  value: boolean | MochiCompressionDictionaryOptions | undefined,
  development: boolean,
  assetPrefix: string,
): ResolvedCompressionDictionary | null {
  if (!value || (typeof value === 'boolean' ? development : !(development ? value.enabledInDev : value.enabledInProd))) {
    return null;
  }
  const opts = typeof value === 'boolean' ? undefined : value;
  return {
    routes: opts?.routes ?? null,
    maxDictionaryBytes: opts?.maxDictionaryBytes ?? DEFAULT_MAX_DICTIONARY_BYTES,
    zstdLevel: opts?.zstdLevel ?? DEFAULT_ZSTD_LEVEL,
    dictionaryPath: `${assetPrefix}/dictionary`,
  };
}
