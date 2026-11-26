// Every response class the framework produces carries the baseline headers by default. Options and the filter are
// covered in securityHeadersOptions.test.ts, since Mochi.serve() is one-per-process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { success } from './runtime/forms';

const PLAIN_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');
const ISLAND_PAGE = path.join(import.meta.dir, '__fixtures__', 'server-island-middleware', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;
let fixtures: string;
let base: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sec-headers-'));
  // Not dot-prefixed: Mochi.file() refuses any path with a dot segment.
  fixtures = mkdtempSync(path.join(import.meta.dir, '..', 'mochi-file-fixtures-sec-'));
  mkdirSync(path.join(fixtures, 'public'));
  mkdirSync(path.join(fixtures, 'media'));
  writeFileSync(path.join(fixtures, 'public', 'note.txt'), 'public note 0123456789');
  writeFileSync(path.join(fixtures, 'media', 'upload.txt'), 'uploaded file');
  writeFileSync(path.join(fixtures, 'report.txt'), 'report');

  server = await Mochi.serve({
    port: 0,
    development: false,
    proxy: { hostHeader: 'host' },
    logger: { enabled: false },
    outDir,
    publicDir: path.join(fixtures, 'public'),
    staticDirs: { '/media': path.join(fixtures, 'media') },
    // Only the verify endpoint matters here; gating no path keeps every other response class ungated.
    protection: { enabled: true, protectFiles: false, protect: () => false },
    routes: {
      '/page': Mochi.page(PLAIN_PAGE),
      '/form': Mochi.page(PLAIN_PAGE, { actions: { default: () => success() } }),
      '/island-host': Mochi.page(ISLAND_PAGE),
      '/api/ok': Mochi.api(() => new Response('ok')),
      '/api/own-policy': Mochi.api(() => new Response('ok', { headers: { 'Referrer-Policy': 'no-referrer' } })),
      '/sse/tick': Mochi.sse((stream) => {
        stream.send('tick');
        stream.close();
      }),
      '/download': Mochi.file(path.join(fixtures, 'report.txt')),
      '/ws': Mochi.ws({
        message(ws, message) {
          ws.send(`echo:${message}`);
        },
      }),
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
  rmSync(fixtures, { recursive: true, force: true });
});

function expectBaseline(res: Response): void {
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(res.headers.get('x-frame-options')).toBeNull();
}

describe('default security headers', () => {
  test('page GET and HEAD', async () => {
    const res = await fetch(`${base}/page`);
    expect(res.status).toBe(200);
    expectBaseline(res);
    const head = await fetch(`${base}/page`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expectBaseline(head);
  });

  test('page action POST', async () => {
    const res = await fetch(`${base}/form`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
    });
    expect(res.status).toBe(200);
    expectBaseline(res);
  });

  test('Mochi.api', async () => {
    const res = await fetch(`${base}/api/ok`);
    expect(await res.text()).toBe('ok');
    expectBaseline(res);
  });

  test('a header the route set itself wins', async () => {
    const res = await fetch(`${base}/api/own-policy`);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('Mochi.sse', async () => {
    const res = await fetch(`${base}/sse/tick`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expectBaseline(res);
    await res.body?.cancel();
  });

  test('server-island endpoint', async () => {
    const html = await (await fetch(`${base}/island-host`)).text();
    const name = html.match(/<mochi-server-island\b[^>]*component-name="([^"]+)"/)![1]!;
    const token = html.match(/<mochi-server-island\b[^>]*signed-props="([^"]+)"/)![1]!;
    const res = await fetch(`${base}/_mochi/island/${name}?props=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('secret-data');
    expectBaseline(res);
  });

  test('Mochi.file', async () => {
    const res = await fetch(`${base}/download`);
    expect(await res.text()).toBe('report');
    expectBaseline(res);
  });

  test('Mochi.ws still upgrades, and a request it does not upgrade carries the headers', async () => {
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const echoed = await new Promise<string>((resolve, reject) => {
      ws.onopen = () => ws.send('hi');
      ws.onmessage = (e) => resolve(String(e.data));
      ws.onerror = reject;
    });
    ws.close();
    expect(echoed).toBe('echo:hi');
    const plain = await fetch(`${base}/ws`);
    expect(plain.status).toBe(500);
    expectBaseline(plain);
  });

  test('protection verify endpoint', async () => {
    const res = await fetch(`${base}/_mochi/protection/verify`);
    expect(res.status).toBe(405);
    expectBaseline(res);
  });

  test('fall-through 404', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expectBaseline(res);
  });

  test('CSRF 403 from the fall-through handler and from a route', async () => {
    const crossOrigin = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' }, body: '' };
    // A page without actions is registered GET-only, so its POST is refused before any route handler runs.
    const fallthrough = await fetch(`${base}/page`, crossOrigin);
    expect(fallthrough.status).toBe(403);
    expectBaseline(fallthrough);
    const routed = await fetch(`${base}/form`, crossOrigin);
    expect(routed.status).toBe(403);
    expectBaseline(routed);
  });

  test('staticDirs files, their 304 and their 404', async () => {
    const res = await fetch(`${base}/media/upload.txt`);
    expect(await res.text()).toBe('uploaded file');
    expectBaseline(res);
    const notModified = await fetch(`${base}/media/upload.txt`, { headers: { 'If-None-Match': res.headers.get('etag')! } });
    expect(notModified.status).toBe(304);
    expectBaseline(notModified);
    const missing = await fetch(`${base}/media/missing.txt`);
    expect(missing.status).toBe(404);
    expectBaseline(missing);
  });
});

describe('publicDir files', () => {
  test('carry the baseline headers', async () => {
    const res = await fetch(`${base}/note.txt`);
    expect(await res.text()).toBe('public note 0123456789');
    expect(res.headers.get('content-type')).toStartWith('text/plain');
    expectBaseline(res);
  });

  test('still answer Range with 206', async () => {
    const res = await fetch(`${base}/note.txt`, { headers: { Range: 'bytes=0-5' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-5/22');
    expect(await res.text()).toBe('public');
    expectBaseline(res);
  });

  test('still answer a conditional GET with 304', async () => {
    const first = await fetch(`${base}/note.txt`);
    const lastModified = first.headers.get('last-modified');
    expect(lastModified).not.toBeNull();
    const res = await fetch(`${base}/note.txt`, { headers: { 'If-Modified-Since': lastModified! } });
    expect(res.status).toBe(304);
    expectBaseline(res);
  });

  test('serve an edit made after boot', async () => {
    writeFileSync(path.join(fixtures, 'public', 'note.txt'), 'edited after boot');
    const res = await fetch(`${base}/note.txt`);
    expect(await res.text()).toBe('edited after boot');
    expectBaseline(res);
  });
});
