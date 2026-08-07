import type { Server } from 'bun';
import { createHash } from 'node:crypto';
import type { MochiDictionaryOptions } from '../types';
import { pinGlobal } from '../utils/globalState';
import { logger } from '../utils/log';
import { markWarmupRequest } from './warmup';
import { trailingSlashRedirect, type TrailingSlashPolicy } from './trailingSlash';

// RFC 9842 §5: a zstd skippable frame (magic 0x184D2A5E LE, length 0x20 LE) followed by the dictionary's SHA-256.
export const DCZ_MAGIC = new Uint8Array([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00]);

export interface DictionaryState {
  bytes: Uint8Array;
  /** SHA-256 of `bytes` (32 bytes). */
  hash: Uint8Array;
  hashB64: string;
  useAsDictionaryHeader: string;
}

export interface ResolvedDictionaryOptions {
  routes: string[];
  match: string;
  matchDest: string[];
  id: string | undefined;
  maxAge: number;
  level: number;
  maxBytes: number;
  /** Serve path of the dictionary route, `${assetPrefix}/dictionary`. */
  dictionaryPath: string;
}

// Pinned so per-component SSR bundles and the server runtime observe one dictionary, mirroring `__mochi_config__`.
const holder = pinGlobal('__mochi_dictionary__', (): { state: DictionaryState | null } => ({ state: null }));

export function getDictionaryState(): DictionaryState | null {
  return holder.state;
}

export function setDictionaryState(state: DictionaryState | null): void {
  holder.state = state;
}

/** Dictionary transport is production-only: dev live-reload mutates HTML constantly, so a boot-time dictionary would mismatch immediately. */
export function resolveDictionaryOptions(dictionary: boolean | MochiDictionaryOptions | undefined, development: boolean, assetPrefix: string): ResolvedDictionaryOptions | null {
  if (!dictionary || development) {
    return null;
  }
  const opts = dictionary === true ? {} : dictionary;
  if (opts.enabled === false) {
    return null;
  }
  return {
    routes: opts.routes ?? ['/'],
    match: opts.match ?? '/*',
    matchDest: opts.matchDest ?? ['document'],
    id: opts.id,
    maxAge: opts.maxAge ?? 86_400,
    level: opts.level ?? 10,
    maxBytes: opts.maxBytes ?? 1024 * 1024,
    dictionaryPath: `${assetPrefix}/dictionary`,
  };
}

function sfString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildUseAsDictionaryHeader(opts: Pick<ResolvedDictionaryOptions, 'match' | 'matchDest' | 'id'>): string {
  let header = `match=${sfString(opts.match)}`;
  if (opts.matchDest.length > 0) {
    header += `, match-dest=(${opts.matchDest.map(sfString).join(' ')})`;
  }
  if (opts.id) {
    header += `, id=${sfString(opts.id)}`;
  }
  return header;
}

/** Parse an `Available-Dictionary` structured-field byte sequence (`:base64:`) into the 32-byte SHA-256 it carries. */
export function parseAvailableDictionary(header: string | null): Uint8Array | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (trimmed.length < 3 || !trimmed.startsWith(':') || !trimmed.endsWith(':')) {
    return null;
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed.slice(1, -1), 'base64');
  } catch {
    return null;
  }
  return decoded.length === 32 ? new Uint8Array(decoded) : null;
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

export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
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

export async function buildDczResponseBody(payload: Uint8Array, state: DictionaryState, level: number): Promise<Uint8Array> {
  const codec = await loadDczCodec();
  // A fresh context per call: the lib's `init()` re-instantiates the wasm heap, so a long-cached cctx can dangle.
  const cctx = codec.createCCtx();
  let compressed: Uint8Array;
  try {
    compressed = codec.compressUsingDict(cctx, payload, state.bytes, level);
  } finally {
    codec.freeCCtx(cctx);
  }
  const body = new Uint8Array(DCZ_MAGIC.length + state.hash.length + compressed.length);
  body.set(DCZ_MAGIC, 0);
  body.set(state.hash, DCZ_MAGIC.length);
  body.set(compressed, DCZ_MAGIC.length + state.hash.length);
  return body;
}

export interface DictionaryBootstrapResult {
  routeCount: number;
  bytes: number;
  hashB64: string;
  durationMs: number;
}

/**
 * Render the configured routes through their real page handlers and install the concatenated HTML as the process
 * dictionary. Runs fire-and-forget after boot; until it resolves, pages simply don't advertise a dictionary.
 */
export async function bootstrapDictionary(input: {
  opts: ResolvedDictionaryOptions;
  handlers: { pattern: string; handler: (req: Request, server: Server<undefined>) => Promise<Response> }[];
  trailingSlashPolicy: TrailingSlashPolicy | undefined;
  server: Server<undefined>;
}): Promise<DictionaryBootstrapResult | null> {
  const { opts, handlers, trailingSlashPolicy, server } = input;
  const t0 = performance.now();
  const parts: Uint8Array[] = [];
  let total = 0;
  let rendered = 0;
  for (const { pattern, handler } of handlers) {
    // The canonical path keeps the trailing-slash policy from redirecting instead of rendering (mirrors warmup).
    const url = new URL(`http://localhost${pattern}`);
    const redirect = trailingSlashPolicy ? trailingSlashRedirect('GET', url, trailingSlashPolicy) : null;
    const href = redirect ? new URL(redirect.headers.get('Location') ?? pattern, url).href : url.href;
    try {
      const response = await handler(markWarmupRequest(new Request(href)), server);
      if (response.status !== 200 || !(response.headers.get('Content-Type')?.startsWith('text/html') ?? false)) {
        logger.warn(`[mochi] dictionary: route "${pattern}" returned ${response.status} ${response.headers.get('Content-Type') ?? ''} — skipped`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const separator = parts.length > 0 ? 1 : 0;
      if (total + separator + bytes.length > opts.maxBytes) {
        logger.warn(`[mochi] dictionary: route "${pattern}" would exceed maxBytes (${opts.maxBytes}) — skipped`);
        continue;
      }
      if (separator) {
        parts.push(new Uint8Array([0x0a]));
      }
      parts.push(bytes);
      total += separator + bytes.length;
      rendered += 1;
    } catch (err) {
      logger.warn(`[mochi] dictionary: route "${pattern}" failed to render: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (total === 0) {
    logger.warn('[mochi] dictionary: no routes rendered successfully — dictionary transport disabled for this boot');
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const hash = new Uint8Array(createHash('sha256').update(bytes).digest());
  // Warm the codec now so the first dcz response doesn't pay wasm instantiation.
  await loadDczCodec();
  setDictionaryState({
    bytes,
    hash,
    hashB64: Buffer.from(hash).toString('base64'),
    useAsDictionaryHeader: buildUseAsDictionaryHeader(opts),
  });
  return { routeCount: rendered, bytes: total, hashB64: Buffer.from(hash).toString('base64'), durationMs: performance.now() - t0 };
}
