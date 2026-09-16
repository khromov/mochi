// Guards the consequences of routing static surfaces through the middleware chain: the chain must not swallow
// extensionless public files under a trailing-slash policy, must not read a whole file to answer HEAD, must keep
// byte-range serving alive under a header-filtering middleware, and must hand `transformPage` only documents.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { Handle } from './runtime/hooks';
import { getRequestContext } from './runtime/requestContext';
import { headResponse } from './utils';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'inline-islands', 'Page.svelte');
const ACME_TOKEN = 'PsG0aQMDoLZgnfsW6z2rBQ.iBnzcbrmxOrTNXTL8mkQtA';
const BIG_BIN = new Uint8Array(64 * 1024).fill(0x7a);

interface SeenRequest {
  method: string;
  path: string;
  kind: string;
  transformKind?: string;
  hasContext: boolean;
}

describe('static surfaces on the middleware chain', () => {
  let server: Server<undefined>;
  let outDir: string;
  let publicDir: string;
  let fixturesDir: string;
  let base: string;
  const seen: SeenRequest[] = [];

  const seenFor = (method: string, pathname: string): SeenRequest | undefined => seen.find((s) => s.method === method && s.path === pathname);

  const recorder: Handle = async ({ event, resolve }) => {
    let transformKind: string | undefined;
    let hasContext = true;
    try {
      getRequestContext();
    } catch {
      hasContext = false;
    }
    const response = await resolve(event, {
      transformPage({ html, kind }) {
        transformKind = kind;
        return html;
      },
      // Rebuilds the Response, which is what used to destroy the BunFile body's range support.
      filterResponseHeaders: (name) => name.toLowerCase() !== 'x-drop-me',
    });
    seen.push({ method: event.request.method, path: event.url.pathname, kind: event.kind, transformKind, hasContext });
    return response;
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-static-chain-out-'));
    publicDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-static-chain-pub-'));
    // Undotted on purpose — `Mochi.file()` refuses any target under a dot-directory.
    fixturesDir = mkdtempSync(path.join(import.meta.dir, '..', 'mochi-file-fixtures-static-chain-'));

    mkdirSync(path.join(publicDir, '.well-known', 'acme-challenge'), { recursive: true });
    writeFileSync(path.join(publicDir, '.well-known', 'acme-challenge', 'token123'), ACME_TOKEN);
    writeFileSync(path.join(publicDir, 'theme.css'), ':root{--x:1}');
    writeFileSync(path.join(publicDir, 'big.bin'), BIG_BIN);
    writeFileSync(path.join(publicDir, 'static.html'), '<html><body>hi</body></html>');
    writeFileSync(path.join(fixturesDir, 'doc.txt'), 'doc contents\n');

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      publicDir,
      trailingSlash: 'always',
      handle: recorder,
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
        '/files/doc.txt': Mochi.file(path.join(fixturesDir, 'doc.txt')),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
    rmSync(fixturesDir, { recursive: true, force: true });
  });

  test('an extensionless public file is served, not redirected, under trailingSlash "always"', async () => {
    const res = await fetch(`${base}/.well-known/acme-challenge/token123`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ACME_TOKEN);
    expect(seenFor('GET', '/.well-known/acme-challenge/token123')?.kind).toBe('public');
  });

  test('an extensionless path with no public file still redirects', async () => {
    const res = await fetch(`${base}/no-such-page`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/no-such-page/');
  });

  test('HEAD on a public file reports the size without sending a body', async () => {
    const res = await fetch(`${base}/big.bin`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe(String(BIG_BIN.byteLength));
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test('headResponse trusts a declared Content-Length instead of reading the body', async () => {
    let pulled = false;
    const body = new ReadableStream({
      pull(controller) {
        pulled = true;
        controller.close();
      },
    });
    const res = await headResponse(new Response(body, { headers: { 'Content-Length': '4096' } }));
    expect(res.headers.get('Content-Length')).toBe('4096');
    expect(pulled).toBe(false);
  });

  test('byte-range serving survives a filterResponseHeaders middleware', async () => {
    const res = await fetch(`${base}/big.bin`, { headers: { Range: 'bytes=0-9' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${BIG_BIN.byteLength}`);
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  test('a suffix range returns the tail', async () => {
    const res = await fetch(`${base}/big.bin`, { headers: { Range: 'bytes=-5' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes ${BIG_BIN.byteLength - 5}-${BIG_BIN.byteLength - 1}/${BIG_BIN.byteLength}`);
    expect((await res.arrayBuffer()).byteLength).toBe(5);
  });

  test('HEAD on a Mochi.file() route runs the middleware chain and carries the GET headers', async () => {
    const res = await fetch(`${base}/files/doc.txt`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(res.headers.get('Last-Modified')).toBeTruthy();
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(seenFor('HEAD', '/files/doc.txt')?.kind).toBe('file');
  });

  test('transformPage sees documents as "page" and island fragments as "deferredIsland"', async () => {
    const pageHtml = await (await fetch(`${base}/`)).text();
    expect(seenFor('GET', '/')?.transformKind).toBe('page');

    const wrapper = [...pageHtml.matchAll(/<mochi-server-island\b[^>]*>/g)]
      .map((m) => ({ key: m[0].match(/component-name="([^"]+)"/)?.[1], token: m[0].match(/signed-props="([^"]+)"/)?.[1] }))
      .find((w) => w.key && w.token);
    expect(wrapper).toBeTruthy();

    const islandPath = `/_mochi/island/${wrapper!.key}`;
    const res = await fetch(`${base}${islandPath}?props=${encodeURIComponent(wrapper!.token!)}`);
    expect(res.status).toBe(200);
    expect(seenFor('GET', islandPath)?.transformKind).toBe('deferredIsland');
  });

  test('middleware sees a request context on the island endpoint', async () => {
    const islandRequest = seen.find((s) => s.path.startsWith('/_mochi/island/'));
    expect(islandRequest).toBeTruthy();
    expect(islandRequest!.hasContext).toBe(true);
  });

  test('transformPage never runs on files served from disk', async () => {
    const publicHtml = await fetch(`${base}/static.html`);
    expect(await publicHtml.text()).toBe('<html><body>hi</body></html>');
    expect(seenFor('GET', '/static.html')?.transformKind).toBeUndefined();

    const fileRoute = await fetch(`${base}/files/doc.txt`);
    expect(await fileRoute.text()).toBe('doc contents\n');
    expect(seenFor('GET', '/files/doc.txt')?.transformKind).toBeUndefined();
  });
});
