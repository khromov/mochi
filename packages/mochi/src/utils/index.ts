// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../negotiator.d.ts" />
import type { Server } from 'bun';
import Negotiator from 'negotiator';
import { STATUS_CODES } from 'node:http';
import path from 'node:path';
import type { MochiCompileErrorLog } from '../events';
import type { BunRouteValue } from '../types';

// Wraps `negotiator` to pin the call shape, so our own tests can guard the q-value behaviour.
export function negotiate(accept: string, types: string[]): string | undefined {
  return new Negotiator({ headers: { accept } }).mediaType(types);
}

/**
 * Convert a native filesystem path to forward-slash form. Windows backslashes corrupt when embedded in generated module
 * source, where they're eaten as JS string escapes, and Bun's importer resolves `C:\dir` and `C:/dir` alike — so every
 * path spliced into a generated `import`/`export` specifier goes through this.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Cwd-relative path for logs, error messages, and reports, always forward-slash so user-facing output and the tests asserting on it match across platforms. */
export function relForDisplay(p: string): string {
  return toPosixPath(path.relative(process.cwd(), p));
}

/** Absolutize a Bun plugin `onResolve` specifier against its importer's directory. */
export function resolveArgsPath(args: { path: string; resolveDir?: string }): string {
  return args.resolveDir ? path.resolve(args.resolveDir, args.path) : path.resolve(args.path);
}

export type CompressionMethod = 'gzip' | 'brotli';

export const COMPRESSION_TOKEN: Record<CompressionMethod, 'gzip' | 'br'> = { gzip: 'gzip', brotli: 'br' };

// `methods` is the server's allowlist (and tiebreak order for `*`); the client's
// header preference (order + q-values) decides among configured methods.
export function negotiateEncoding(acceptEncoding: string, methods: CompressionMethod[]): CompressionMethod | null {
  const tokens = methods.map((m) => COMPRESSION_TOKEN[m]);
  const best = new Negotiator({ headers: { 'accept-encoding': acceptEncoding } }).encodings(tokens)[0];
  return methods.find((m) => COMPRESSION_TOKEN[m] === best) ?? null;
}

/** Create a JSON response. */
export function json(
  data: unknown,
  init?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  },
): Response {
  const body = JSON.stringify(data);
  const headers: Record<string, string> = {
    ...init?.headers,
    'Content-Type': 'application/json',
  };
  return new Response(body, {
    status: init?.status,
    statusText: init?.statusText,
    headers,
  });
}

export function httpStatusText(status: number): string {
  return STATUS_CODES[status] ?? `Error ${status}`;
}

/** Throws an error the framework catches and turns into a JSON error response. Omitting `message` uses the canonical status text. */
export function error(status: number, message?: string): never {
  throw new MochiHttpError(status, message);
}

export class MochiHttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? httpStatusText(status));
    this.status = status;
  }
}

/** Build a JSON error `Response` with the canonical Mochi envelope `{ error: { message, status } }`, for returning a typed error from `Mochi.api()` without throwing. */
export function apiError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, status } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// `getSetCookie()` keeps multiple `Set-Cookie` headers as separate entries rather than comma-merging them.
export function collectHeaderPairs(headers: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of headers) {
    if (k.toLowerCase() === 'set-cookie') {
      continue;
    }
    out.push([k, v]);
  }
  for (const c of headers.getSetCookie()) {
    out.push(['set-cookie', c]);
  }
  return out;
}

export function isHtmlResponse(response: Response): boolean {
  return response.headers.get('Content-Type')?.startsWith('text/html') ?? false;
}

export function appendVary(headers: Headers, value: string): void {
  const existing = headers.get('Vary');
  if (!existing) {
    headers.set('Vary', value);
    return;
  }
  if (existing.trim() === '*') {
    return;
  }
  const tokens = existing.split(',').map((t) => t.trim().toLowerCase());
  if (tokens.includes(value.toLowerCase())) {
    return;
  }
  headers.set('Vary', `${existing}, ${value}`);
}

/** Extract Bun's route params from a Request object. */
export function extractParams(req: Request): Record<string, string> {
  return ((req as unknown as Record<string, unknown>).params as Record<string, string>) ?? {};
}

export const DEFAULT_ASSET_PREFIX = '/_mochi';

// Returns the default when undefined and throws on a missing leading slash, root `/`, trailing slash, whitespace, or `..` segment.
export function normalizeAssetPrefix(input: string | undefined): string {
  if (input === undefined) {
    return DEFAULT_ASSET_PREFIX;
  }
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error(`[mochi] assetPrefix must be a non-empty string, got ${JSON.stringify(input)}`);
  }
  if (!input.startsWith('/')) {
    throw new Error(`[mochi] assetPrefix must start with "/", got ${JSON.stringify(input)}`);
  }
  if (input === '/') {
    throw new Error(`[mochi] assetPrefix must not be the root "/" — pick a sub-path like "/_mochi"`);
  }
  if (input.endsWith('/')) {
    throw new Error(`[mochi] assetPrefix must not end with "/", got ${JSON.stringify(input)}`);
  }
  if (/\s/.test(input)) {
    throw new Error(`[mochi] assetPrefix must not contain whitespace, got ${JSON.stringify(input)}`);
  }
  if (input.split('/').includes('..')) {
    throw new Error(`[mochi] assetPrefix must not contain ".." segments, got ${JSON.stringify(input)}`);
  }
  return input;
}

// Centralized so a future CSP `nonce`/`crossorigin` attribute lands in one place; the URL is an internal hashed asset
// path rather than user input, so it goes in unescaped.
export function cssLinkTag(url: string): string {
  return `<link rel="stylesheet" href="${url}">`;
}

/** Guards against a many-subset font package turning the preload hint into unconditional downloads of every subset. */
export const FONT_PRELOAD_MAX = 8;

// `crossorigin` is mandatory: font requests are CORS-mode even same-origin, and a mode mismatch double-fetches.
export function fontPreloadTag(url: string): string {
  return `<link rel="preload" as="font" type="font/woff2" href="${url}" crossorigin>`;
}

/**
 * Test whether an HTML comment's text is a Svelte SSR hydration marker. `text` must be the comment's inner bytes, with
 * the surrounding `<!--` `-->` already stripped by the caller, since the patterns below assume it.
 */
export function isSvelteMarker(text: string): boolean {
  // Svelte emits:
  //   <!--[-->, <!--]-->          block open/close (HYDRATION_START / HYDRATION_END)
  //   <!--[!-->                   pending boundary (HYDRATION_START_ELSE)
  //   <!--[?<json>-->             failed boundary (HYDRATION_START_FAILED)
  //   <!--[0-->, <!--[1-->, ...   {#if} branch index (0 = consequent,
  //   <!--[-1-->                   N = nth :else if, -1 = final :else)
  //   <!---->, <!--s8967g-->      empty / component hash
  return text === '[' || text === ']' || text === '[!' || text.startsWith('[?') || /^\[-?\d+$/.test(text) || /^\w*$/.test(text);
}

/**
 * Collapse the doubled-marker pattern Svelte SSR emits for some component shapes (`$state` arrays + `{@attach}` — see
 * `/demos/reload-form-data/`), where the inner `<svelte:boundary>` writes two `<!--[-->`/`<!--]-->` pairs at the wrapper
 * edges instead of one and the client `hydrate()` walker advances past only the first, then hits `HierarchyRequestError`.
 *
 * The doubled open and doubled close match as one unit so the regex fires only on the bug case: `{#if}`/`{:else}` blocks
 * legitimately close with `<!--]--><!--]-->`, but their second open marker is a branch index like `<!--[0-->`.
 */
export function normalizeIslandHydrationMarkers(html: string): string {
  return html.replace(/(<mochi-hydratable-island\b[^>]*>)<!--\[--><!--\[-->(.*?)<!--\]--><!--\]-->(<\/mochi-hydratable-island>)/gs, '$1<!--[-->$2<!--]-->$3');
}

/**
 * Strip Svelte SSR hydration markers from HTML while preserving them inside `<mochi-hydratable-island>` and
 * `<mochi-server-island>` blocks, parsing through Bun's HTMLRewriter so element nesting is tracked properly.
 */
export function stripHydrationMarkers(html: string): string {
  let islandDepth = 0;
  const trackIsland = {
    element(el: HTMLRewriterTypes.Element) {
      islandDepth++;
      el.onEndTag(() => {
        islandDepth--;
      });
    },
  };

  return new HTMLRewriter()
    .on('mochi-hydratable-island', trackIsland)
    .on('mochi-server-island', trackIsland)
    .onDocument({
      comments(comment) {
        if (islandDepth === 0 && isSvelteMarker(comment.text)) {
          comment.remove();
        }
      },
    })
    .transform(html);
}

// Position fields are elided when missing, keeping the `compile:error` payload minimal for handlers that only want `{ file, message }`.
export function toCompileErrorLogs(
  logs: ReadonlyArray<{
    message: string;
    position?: { file: string; line: number; column: number } | null;
  }>,
): MochiCompileErrorLog[] {
  return logs.map((l) => {
    const entry: MochiCompileErrorLog = { message: l.message };
    const pos = l.position;
    if (pos?.file) {
      entry.file = pos.file;
    }
    if (typeof pos?.line === 'number') {
      entry.line = pos.line;
    }
    if (typeof pos?.column === 'number') {
      entry.column = pos.column;
    }
    return entry;
  });
}

/**
 * Body-less clone of a `Response` for answering HEAD. Finite bodies are buffered once so `Content-Length` matches what
 * the equivalent GET would have sent; a streaming body (`text/event-stream`) would never end, so its length is left unset.
 */
export async function headResponse(res: Response): Promise<Response> {
  const headers = new Headers(res.headers);
  const isStream = (headers.get('content-type') ?? '').includes('text/event-stream');
  if (!isStream && res.body) {
    const buf = await res.arrayBuffer();
    headers.set('Content-Length', String(buf.byteLength));
  }
  return new Response(null, { status: res.status, statusText: res.statusText, headers });
}

type RouteFn = (req: Request, server: Server<undefined>) => Response | Promise<Response>;

/**
 * Wrap a page/api `BunRouteValue` so HEAD reuses the GET handler's logic and returns no body. A bare function runs for
 * every method with its result stripped only on HEAD; a method-keyed object gains a `HEAD` entry running `GET`, since Bun
 * 405s an unlisted HEAD. `Response` and `BunFile` pass through untouched, as Bun serves their HEAD itself.
 */
export function withHead(value: BunRouteValue): BunRouteValue {
  if (typeof value === 'function') {
    const fn = value as RouteFn;
    return async (req, server) => {
      const res = await fn(req, server);
      return req.method === 'HEAD' ? headResponse(res) : res;
    };
  }
  if (value && typeof value === 'object' && !(value instanceof Response) && !(value instanceof Blob)) {
    const rec = value as Record<string, RouteFn>;
    const get = rec.GET;
    if (get && !rec.HEAD) {
      return { ...rec, HEAD: async (req, server) => headResponse(await get(req, server)) };
    }
  }
  return value;
}
