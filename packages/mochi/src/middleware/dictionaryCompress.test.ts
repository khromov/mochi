import { describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import type { MochiEvent } from '../runtime/hooks';
import { sequence } from '../runtime/hooks';
import { MochiCookieJar } from '../runtime/cookies';
import { requestContext, type MochiRequestContext } from '../runtime/requestContext';
import { DCZ_MAGIC, DictionaryStore, loadDczCodec, type ResolvedCompressionDictionary } from '../runtime/compressionDictionary';
import { createDictionaryHandle } from './dictionaryCompress';
import { compress } from './compress';

const DICT = new TextEncoder().encode('<html><head><title>site</title></head><body><nav>Home Docs About</nav>'.repeat(30));
const PAGE = '<html><head><title>site</title></head><body><nav>Home Docs About</nav><main>' + 'page body '.repeat(100) + '</main></body></html>';

const CHROME_ACCEPT = 'gzip, br, zstd, dcb, dcz';

const OPTS: ResolvedCompressionDictionary = {
  routes: null,
  maxDictionaryBytes: 1024 * 1024,
  zstdLevel: 10,
  dictionaryPath: '/_mochi/dictionary',
};

function freshStore(): { store: DictionaryStore; header: string; hashHex: string } {
  const store = new DictionaryStore();
  const entry = store.add(DICT);
  return { store, header: `:${Buffer.from(entry.hash).toString('base64')}:`, hashHex: entry.hashHex };
}

function makeEvent(req: Request, kind: MochiEvent['kind'] = 'page'): MochiEvent {
  return { request: req, url: new URL(req.url), server: {} as Server<undefined>, locals: {}, kind, isWarmup: false };
}

function htmlResponse(body: string = PAGE, init: ResponseInit = {}): Response {
  return new Response(body, { ...init, headers: { 'Content-Type': 'text/html; charset=utf-8', ...init.headers } });
}

function dczRequest(url = 'http://localhost/page', extra: Record<string, string> = {}, header?: string): Request {
  return new Request(url, { headers: { 'Accept-Encoding': 'gzip, br, zstd, dcb, dcz', ...(header ? { 'Available-Dictionary': header } : {}), ...extra } });
}

async function decodeDcz(response: Response): Promise<{ magic: Uint8Array; hash: Uint8Array; text: string }> {
  const body = new Uint8Array(await response.arrayBuffer());
  // Reuse the framework's single init: the lib's init() is not idempotent and corrupts in-flight contexts when re-run.
  await loadDczCodec();
  const { createDCtx, decompressUsingDict } = await import('@bokuweb/zstd-wasm');
  return { magic: body.slice(0, 8), hash: body.slice(8, 40), text: new TextDecoder().decode(decompressUsingDict(createDCtx(), body.slice(40), DICT)) };
}

describe('createDictionaryHandle()', () => {
  test('serves dcz when the client advertises the matching dictionary', async () => {
    const { store, header, hashHex } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);

    const response = await handle({ event: makeEvent(dczRequest(undefined, {}, header)), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBe('dcz');
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
    expect(response.headers.get('Link')).toBe(`</_mochi/dictionary/${hashHex}>; rel="compression-dictionary"`);

    const { magic, text } = await decodeDcz(response);
    expect(magic).toEqual(DCZ_MAGIC);
    expect(text).toBe(PAGE);
  });

  test('advertises Link + Vary without compressing when the client has no dictionary', async () => {
    const { store, hashHex } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);
    const req = new Request('http://localhost/page', { headers: { 'Accept-Encoding': 'gzip, br' } });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Link')).toBe(`</_mochi/dictionary/${hashHex}>; rel="compression-dictionary"`);
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
    expect(await response.text()).toBe(PAGE);
  });

  test('falls back on a hash miss', async () => {
    const { store } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);
    const stale = `:${Buffer.alloc(32, 7).toString('base64')}:`;

    const response = await handle({ event: makeEvent(dczRequest(undefined, {}, stale)), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.text()).toBe(PAGE);
  });

  // The framework only ever registers one dictionary per boot, but the store matches any it holds — the hook a future
  // deploy-spanning dictionary would need.
  test('a client holding a non-current registered dictionary gets a dcz framed against that one', async () => {
    const { store } = freshStore();
    const old = store.add(new TextEncoder().encode('an older deploy'.repeat(50)));
    const current = store.add(new TextEncoder().encode('the newest deploy'.repeat(50)));
    const handle = createDictionaryHandle(OPTS, store);
    const header = `:${Buffer.from(old.hash).toString('base64')}:`;

    const response = await handle({ event: makeEvent(dczRequest(undefined, {}, header)), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBe('dcz');
    expect(response.headers.get('Link')).toBe(`</_mochi/dictionary/${current.hashHex}>; rel="compression-dictionary"`);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.slice(8, 40)).toEqual(old.hash);
  });

  test('falls back when dcz is offered with q=0', async () => {
    const { store, header } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);
    const req = new Request('http://localhost/page', { headers: { 'Accept-Encoding': 'dcz;q=0, gzip', 'Available-Dictionary': header } });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  test('Accept-Encoding: * never selects dcz', async () => {
    const { store, header } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);
    const req = new Request('http://localhost/page', { headers: { 'Accept-Encoding': '*', 'Available-Dictionary': header } });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  test('does nothing before the boot harvest installs a dictionary', async () => {
    const store = new DictionaryStore();
    const handle = createDictionaryHandle(OPTS, store);
    const header = `:${Buffer.alloc(32, 1).toString('base64')}:`;

    const response = await handle({ event: makeEvent(dczRequest(undefined, {}, header)), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Link')).toBeNull();
    expect(response.headers.get('Vary')).toBeNull();
  });

  test('skips non-page kinds, non-GET methods, non-200 statuses, and non-HTML bodies', async () => {
    const { store, header } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);

    const asset = await handle({ event: makeEvent(dczRequest('http://localhost/a.js', {}, header), 'asset'), resolve: async () => htmlResponse() });
    expect(asset.headers.get('Link')).toBeNull();

    const post = await handle({
      event: makeEvent(new Request('http://localhost/page', { method: 'POST', headers: { 'Accept-Encoding': 'dcz', 'Available-Dictionary': header } })),
      resolve: async () => htmlResponse(),
    });
    expect(post.headers.get('Content-Encoding')).toBeNull();
    expect(post.headers.get('Link')).toBeNull();

    const notFound = await handle({ event: makeEvent(dczRequest(undefined, {}, header)), resolve: async () => htmlResponse(PAGE, { status: 404 }) });
    expect(notFound.headers.get('Content-Encoding')).toBeNull();
    expect(notFound.headers.get('Link')).toBeNull();

    const json = await handle({
      event: makeEvent(dczRequest(undefined, {}, header)),
      resolve: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    });
    expect(json.headers.get('Link')).toBeNull();
  });

  test('HEAD mirrors the GET advertisement headers but is never encoded', async () => {
    const { store, header, hashHex } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);
    const req = new Request('http://localhost/page', { method: 'HEAD', headers: { 'Accept-Encoding': CHROME_ACCEPT, 'Available-Dictionary': header } });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    // A shared cache may store a HEAD response, so it needs the same Vary as the GET it mirrors.
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
    expect(response.headers.get('Link')).toBe(`</_mochi/dictionary/${hashHex}>; rel="compression-dictionary"`);
    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  test('skips dcz when the response already carries Set-Cookie', async () => {
    const { store, header, hashHex } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);

    const response = await handle({
      event: makeEvent(dczRequest(undefined, {}, header)),
      resolve: async () => htmlResponse(PAGE, { headers: { 'Set-Cookie': 'session=abc' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    // Still advertised: only the delta encoding is withheld, not the dictionary itself.
    expect(response.headers.get('Link')).toBe(`</_mochi/dictionary/${hashHex}>; rel="compression-dictionary"`);
  });

  test('skips dcz for a cookie pending on the jar, which finalizeCookieHeaders only attaches after middleware', async () => {
    const { store, header } = freshStore();
    const handle = createDictionaryHandle(OPTS, store);
    const jar = new MochiCookieJar(null);
    jar.set('session', 'abc');
    const ctx = { cookies: jar } as MochiRequestContext;

    const response = await requestContext.run(ctx, () => handle({ event: makeEvent(dczRequest(undefined, {}, header)), resolve: async () => htmlResponse() }));

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.text()).toBe(PAGE);
  });

  test('composes with compress(): dcz passes through untouched', async () => {
    const { store, header } = freshStore();
    const handle = sequence(compress(), createDictionaryHandle(OPTS, store));

    const response = await handle({ event: makeEvent(dczRequest(undefined, {}, header)), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBe('dcz');
    expect((await decodeDcz(response)).text).toBe(PAGE);
  });

  test('composes with compress(): clients without a dictionary still get zstd', async () => {
    const { store, hashHex } = freshStore();
    const handle = sequence(compress(), createDictionaryHandle(OPTS, store));
    const req = new Request('http://localhost/page', { headers: { 'Accept-Encoding': 'zstd, gzip' } });

    const response = await handle({ event: makeEvent(req), resolve: async () => htmlResponse() });

    expect(response.headers.get('Content-Encoding')).toBe('zstd');
    expect(response.headers.get('Link')).toBe(`</_mochi/dictionary/${hashHex}>; rel="compression-dictionary"`);
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Available-Dictionary');
  });
});
