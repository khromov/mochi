import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { createHash } from 'node:crypto';
import type { MochiEvent } from '../runtime/hooks';
import { sequence } from '../runtime/hooks';
import { DCZ_MAGIC, loadDczCodec, setDictionaryState, type ResolvedDictionaryOptions } from '../runtime/dictionary';
import { createDictionaryHandle } from './dictionaryCompress';
import { compress } from './compress';

const DICT = new TextEncoder().encode('<html><head><title>site</title></head><body><nav>Home Docs About</nav>'.repeat(30));
const HASH = new Uint8Array(createHash('sha256').update(DICT).digest());
const HASH_B64 = Buffer.from(HASH).toString('base64');
const PAGE = '<html><head><title>site</title></head><body><nav>Home Docs About</nav><main>' + 'page body '.repeat(100) + '</main></body></html>';

const OPTS: ResolvedDictionaryOptions = {
  routes: ['/'],
  match: '/*',
  matchDest: ['document'],
  id: undefined,
  maxAge: 86_400,
  level: 10,
  maxBytes: 1024 * 1024,
  dictionaryPath: '/_mochi/dictionary',
};

function installState(): void {
  setDictionaryState({ bytes: DICT, hash: HASH, hashB64: HASH_B64, useAsDictionaryHeader: 'match="/*", match-dest=("document")' });
}

function makeEvent(req: Request, kind: MochiEvent['kind'] = 'page'): MochiEvent {
  return { request: req, url: new URL(req.url), server: {} as Server<undefined>, locals: {}, kind, isWarmup: false };
}

function htmlResponse(body: string = PAGE, headers: Record<string, string> = {}): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

async function decodeDcz(response: Response): Promise<{ magic: Uint8Array; hash: Uint8Array; text: string }> {
  const body = new Uint8Array(await response.arrayBuffer());
  // Reuse the framework's single init: the lib's init() is not idempotent and corrupts in-flight contexts when re-run.
  await loadDczCodec();
  const { createDCtx, decompressUsingDict } = await import('@bokuweb/zstd-wasm');
  const restored = decompressUsingDict(createDCtx(), body.slice(40), DICT);
  return { magic: body.slice(0, 8), hash: body.slice(8, 40), text: new TextDecoder().decode(restored) };
}

afterEach(() => {
  setDictionaryState(null);
});

describe('createDictionaryHandle()', () => {
  test('serves dcz when the client advertises the matching dictionary', async () => {
    installState();
    const handle = createDictionaryHandle(OPTS);
    const req = new Request('http://localhost/page', {
      headers: { 'Accept-Encoding': 'gzip, br, zstd, dcb, dcz', 'Available-Dictionary': `:${HASH_B64}:` },
    });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBe('dcz');
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
    expect(response.headers.get('Link')).toBe('</_mochi/dictionary>; rel="compression-dictionary"');

    const { magic, hash, text } = await decodeDcz(response);
    expect(Array.from(magic)).toEqual(Array.from(DCZ_MAGIC));
    expect(Buffer.from(hash).equals(Buffer.from(HASH))).toBe(true);
    expect(text).toBe(PAGE);
  });

  test('advertises Link + Vary without compressing when the client has no dictionary', async () => {
    installState();
    const handle = createDictionaryHandle(OPTS);
    const req = new Request('http://localhost/page', { headers: { 'Accept-Encoding': 'gzip, br' } });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Link')).toBe('</_mochi/dictionary>; rel="compression-dictionary"');
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
    expect(await response.text()).toBe(PAGE);
  });

  test('falls back on hash mismatch', async () => {
    installState();
    const handle = createDictionaryHandle(OPTS);
    const wrong = Buffer.alloc(32, 7).toString('base64');
    const req = new Request('http://localhost/page', {
      headers: { 'Accept-Encoding': 'dcz', 'Available-Dictionary': `:${wrong}:` },
    });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.text()).toBe(PAGE);
  });

  test('falls back when dcz is offered with q=0', async () => {
    installState();
    const handle = createDictionaryHandle(OPTS);
    const req = new Request('http://localhost/page', {
      headers: { 'Accept-Encoding': 'dcz;q=0, gzip', 'Available-Dictionary': `:${HASH_B64}:` },
    });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  test('does nothing without installed state', async () => {
    const handle = createDictionaryHandle(OPTS);
    const req = new Request('http://localhost/page', {
      headers: { 'Accept-Encoding': 'dcz', 'Available-Dictionary': `:${HASH_B64}:` },
    });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Link')).toBeNull();
    expect(response.headers.get('Vary')).toBeNull();
  });

  test('skips non-page kinds, non-GET methods, non-200 statuses, and non-HTML bodies', async () => {
    installState();
    const handle = createDictionaryHandle(OPTS);
    const dczHeaders = { 'Accept-Encoding': 'dcz', 'Available-Dictionary': `:${HASH_B64}:` };

    const asset = await handle({ event: makeEvent(new Request('http://localhost/a.js', { headers: dczHeaders }), 'asset'), resolve: async () => htmlResponse() });
    expect(asset.headers.get('Link')).toBeNull();

    const post = await handle({ event: makeEvent(new Request('http://localhost/page', { method: 'POST', headers: dczHeaders })), resolve: async () => htmlResponse() });
    expect(post.headers.get('Link')).toBeNull();

    const notFound = await handle({
      event: makeEvent(new Request('http://localhost/page', { headers: dczHeaders })),
      resolve: async () => new Response(PAGE, { status: 404, headers: { 'Content-Type': 'text/html' } }),
    });
    expect(notFound.headers.get('Link')).toBeNull();

    const json = await handle({
      event: makeEvent(new Request('http://localhost/page', { headers: dczHeaders })),
      resolve: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    });
    expect(json.headers.get('Link')).toBeNull();
  });

  test('skips dcz when the response sets cookies', async () => {
    installState();
    const handle = createDictionaryHandle(OPTS);
    const req = new Request('http://localhost/page', {
      headers: { 'Accept-Encoding': 'dcz', 'Available-Dictionary': `:${HASH_B64}:` },
    });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse(PAGE, { 'Set-Cookie': 'session=abc' }) });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    // Still advertised: only the delta encoding is withheld, not the dictionary itself.
    expect(response.headers.get('Link')).toBe('</_mochi/dictionary>; rel="compression-dictionary"');
  });

  test('composes with compress(): dcz passes through untouched', async () => {
    installState();
    const handle = sequence(compress(), createDictionaryHandle(OPTS));
    const req = new Request('http://localhost/page', {
      headers: { 'Accept-Encoding': 'gzip, br, dcz', 'Available-Dictionary': `:${HASH_B64}:` },
    });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBe('dcz');
    const { text } = await decodeDcz(response);
    expect(text).toBe(PAGE);
  });

  test('composes with compress(): clients without a dictionary still get brotli', async () => {
    installState();
    const handle = sequence(compress(), createDictionaryHandle(OPTS));
    const req = new Request('http://localhost/page', { headers: { 'Accept-Encoding': 'br' } });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBe('br');
    expect(response.headers.get('Link')).toBe('</_mochi/dictionary>; rel="compression-dictionary"');
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
  });
});
