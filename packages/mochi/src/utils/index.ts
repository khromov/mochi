// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../negotiator.d.ts" />
import type { Server } from 'bun';
import Negotiator from 'negotiator';
import path from 'node:path';
import type { MochiCompileErrorLog } from '../events';
import type { BunRouteValue } from '../types';

/**
 * Given an Accept header value and a list of candidate content types, return
 * the best match according to q-value content negotiation, or `undefined` if
 * none of the candidates is acceptable. Thin wrapper around `negotiator` that
 * pins the call shape and lets us guard the behaviour with our own tests.
 */
export function negotiate(accept: string, types: string[]): string | undefined {
  return new Negotiator({ headers: { accept } }).mediaType(types);
}

/**
 * Convert a native filesystem path to forward-slash form. Backslash separators
 * (Windows) corrupt when embedded in generated module source — they are eaten
 * as JS string escapes — and `C:\dir` resolves the same as `C:/dir` for Bun's
 * importer, so POSIX-ifying is safe and what we want everywhere we splice a
 * path into a generated `import`/`export` specifier.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Cwd-relative path for logs, error messages, and reports — always
 * forward-slash so user-facing output (and the tests that assert on it) is
 * identical across platforms.
 */
export function relForDisplay(p: string): string {
  return toPosixPath(path.relative(process.cwd(), p));
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

/**
 * Create a JSON response. Convenience helper similar to SvelteKit's `json()`.
 */
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

/**
 * Create an error response. Throws an error that the framework catches and
 * returns as a JSON error response.
 */
export function error(status: number, message: string): never {
  throw new MochiHttpError(status, message);
}

export class MochiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Build a JSON error `Response` with the canonical Mochi envelope
 * `{ error: { message, status } }`. Use this inside `Mochi.api()` handlers to
 * return a typed error without throwing.
 */
export function apiError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, status } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Snapshot the outgoing response headers as `[name, value]` pairs. Multiple
 * `Set-Cookie` headers are emitted as separate entries via `getSetCookie()`
 * instead of being comma-merged.
 */
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

/**
 * Normalize a user-supplied asset prefix. Returns the default when undefined,
 * throws on invalid input (missing leading slash, root `/`, trailing slash,
 * whitespace, `..` segments).
 */
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

/**
 * A `<link rel="stylesheet">` tag for a compiled CSS asset URL. Centralized so a
 * future CSP `nonce`/`crossorigin` attribute is added in one place; the URL is an
 * internal hashed asset path, not user input, so it's not escaped.
 */
export function cssLinkTag(url: string): string {
  return `<link rel="stylesheet" href="${url}">`;
}

/**
 * Test whether an HTML comment's text is a Svelte SSR hydration marker.
 *
 * `text` must be the *inner* text of an HTML comment (i.e. the bytes between
 * `<!--` and `-->`), not arbitrary HTML — the patterns below assume the
 * surrounding `<!-- -->` has already been stripped by the caller.
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
 * Collapse the doubled-marker pattern that Svelte SSR emits for some component
 * shapes (`$state` arrays + `{@attach}` — see `/demos/reload-form-data/`).
 *
 * The bug: Svelte's inner `<svelte:boundary>` emits TWO `<!--[-->`/`<!--]-->`
 * pairs at the wrapper edges instead of one. The client `hydrate()` walker
 * advances past only the first pair, then chokes when it expects an Element
 * but finds another marker → `HierarchyRequestError`.
 *
 * We match the pattern as a UNIT (doubled open AND doubled close, both
 * immediately adjacent to the wrapper edges) so that the regex only fires on
 * the bug case. Components with `{#if}`/`{:else}` blocks naturally emit
 * `<!--]--><!--]-->` at their close (close-branch + close-block) but don't
 * have `<!--[--><!--[-->` at their open — the second open marker is a branch
 * index like `<!--[0-->` or `<!--[-1-->`. Matching open+close as a single
 * pattern avoids touching those.
 */
export function normalizeIslandHydrationMarkers(html: string): string {
  return html.replace(/(<mochi-hydratable-island\b[^>]*>)<!--\[--><!--\[-->(.*?)<!--\]--><!--\]-->(<\/mochi-hydratable-island>)/gs, '$1<!--[-->$2<!--]-->$3');
}

/**
 * Strip Svelte SSR hydration markers from HTML, but preserve them inside
 * `<mochi-hydratable-island>` and `<mochi-server-island>` blocks.
 *
 * Uses Bun's HTMLRewriter (based on Cloudflare's lol-html) to properly parse
 * HTML and track element nesting instead of fragile regex/manual scanning.
 *
 * NOTE(bun<1.4.0): the obvious implementation tracks island nesting depth with
 * `el.onEndTag(() => islandDepth--)`, but registering an `onEndTag` callback
 * while inside a request's `AsyncLocalStorage` context leaks that context
 * frame — and thus the whole request (BunRequest, cookies, …) — for the life
 * of the process on Bun 1.3.x. Instead we flag island-internal comments via an
 * element-scoped `comments` handler, which lol-html invokes immediately before
 * the document handler for the same comment. Once the minimum supported Bun is
 * >= 1.4.0, revert this to the simpler onEndTag depth counter.
 */
export function stripHydrationMarkers(html: string): string {
  let insideIsland = false;
  const markInside = {
    comments() {
      insideIsland = true;
    },
  };

  return new HTMLRewriter()
    .on('mochi-hydratable-island', markInside)
    .on('mochi-server-island', markInside)
    .onDocument({
      comments(comment) {
        if (insideIsland) {
          insideIsland = false;
          return;
        }
        if (isSvelteMarker(comment.text)) {
          comment.remove();
        }
      },
    })
    .transform(html);
}

/**
 * Project a `Bun.build()` failure's `logs` array to the structured shape the
 * `compile:error` event ships. Position fields are elided when missing so the
 * payload stays minimal for handlers that just want `{ file, message }`.
 */
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
 * Body-less clone of a `Response` for answering a HEAD request: same status,
 * statusText, and headers, but no body. Finite bodies are buffered once so the
 * `Content-Length` matches what the equivalent GET would have sent. Streaming
 * bodies (`text/event-stream`) are never consumed — they would never end — so
 * their length is left unset.
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
 * Wrap a page/api `BunRouteValue` so HEAD reuses the GET/handler logic but
 * returns no body. A single function is invoked for every method and its result
 * is stripped only when the method is HEAD; a method-keyed object gains a `HEAD`
 * entry that runs `GET` (Bun would otherwise 405 an unlisted HEAD). Other shapes
 * (`Response`, `BunFile`) are returned untouched — Bun serves their HEAD itself.
 * `BunFile` is detected via `instanceof Blob` (Bun's file handle subclasses it).
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
