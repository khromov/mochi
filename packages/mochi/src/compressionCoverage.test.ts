// End-to-end guard that `compress()` now reaches every static-serving surface that previously bypassed the middleware
// chain: publicDir files, `Mochi.file()` routes, and server-island fragments. Also covers the conditional-request and
// range handling the disk-file server adds so compression doesn't cost caching, and the font content-type allowlist.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { compress } from './middleware/compress';
import { sequence } from './runtime/hooks';
import { mochiEvents } from './events';
import type { MochiRequestEvent } from './events';
import { registerLocalImageAsset } from './image/localAssetRegistry';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'inline-islands', 'Page.svelte');
const THEME_CSS = `:root{--x:1}\n${'.filler{color:red;background:blue;padding:1px}\n'.repeat(400)}`;
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="4" height="4" fill="#abc"/>'.repeat(200)}</svg>`;

describe('compression reaches every static surface', () => {
  let server: Server<undefined>;
  let outDir: string;
  let publicDir: string;
  let fixturesDir: string;
  let base: string;
  const seenKinds: Record<string, string> = {};

  const onRequest = (e: MochiRequestEvent): void => {
    seenKinds[e.path] = e.kind;
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-compress-cov-out-'));
    publicDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-compress-cov-pub-'));
    // Undotted on purpose — `Mochi.file()` refuses any target under a dot-directory. `mochi-file-fixtures-*` is the
    // prefix packages/mochi/.gitignore already covers.
    fixturesDir = mkdtempSync(path.join(import.meta.dir, '..', 'mochi-file-fixtures-compress-cov-'));
    writeFileSync(path.join(publicDir, 'theme.css'), THEME_CSS);
    writeFileSync(path.join(publicDir, 'font.ttf'), Buffer.alloc(4096, 0x41));
    writeFileSync(path.join(publicDir, 'font.woff2'), Buffer.alloc(4096, 0x41));
    writeFileSync(path.join(publicDir, 'photo.png'), Buffer.alloc(4096, 0x41));
    writeFileSync(path.join(publicDir, 'clip.mp4'), Buffer.alloc(4096, 0x41));
    // Registered the way the build's image loader does, so the asset endpoint has something to serve.
    const logoPath = path.join(fixturesDir, 'logo.svg');
    writeFileSync(logoPath, LOGO_SVG);
    registerLocalImageAsset('/_mochi/asset/logo-abc123.svg', { diskPath: logoPath, contentType: 'image/svg+xml' });
    writeFileSync(path.join(fixturesDir, 'report.txt'), 'report line\n'.repeat(300));

    mochiEvents.on('request', onRequest);

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      publicDir,
      handle: sequence(compress()),
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
        '/files/report.txt': Mochi.file(path.join(fixturesDir, 'report.txt')),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    mochiEvents.off('request', onRequest);
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
    rmSync(fixturesDir, { recursive: true, force: true });
  });

  // Bun's fetch transparently decompresses the body but keeps the Content-Encoding header, so assertions check the
  // header for proof of compression and read the (auto-decompressed) body for content.
  test('publicDir CSS is compressed with Vary and event.kind "public"', async () => {
    const res = await fetch(`${base}/theme.css`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Encoding')).toBe('gzip');
    expect((res.headers.get('Vary') ?? '').toLowerCase()).toContain('accept-encoding');
    expect(await res.text()).toBe(THEME_CSS);
    expect(seenKinds['/theme.css']).toBe('public');
  });

  test('publicDir ttf is compressed but woff2 is not', async () => {
    const ttf = await fetch(`${base}/font.ttf`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(ttf.headers.get('Content-Type')).toBe('font/ttf');
    expect(ttf.headers.get('Content-Encoding')).toBe('gzip');

    const woff2 = await fetch(`${base}/font.woff2`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(woff2.headers.get('Content-Type')).toBe('font/woff2');
    expect(woff2.headers.get('Content-Encoding')).toBeNull();
  });

  test('publicDir supports conditional requests (304)', async () => {
    const first = await fetch(`${base}/theme.css`);
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();
    expect(first.headers.get('Last-Modified')).toBeTruthy();

    const second = await fetch(`${base}/theme.css`, { headers: { 'If-None-Match': etag! } });
    expect(second.status).toBe(304);
  });

  test('a client revalidating a compressed representation gets a 304 carrying its own validator', async () => {
    const first = await fetch(`${base}/theme.css`, { headers: { 'Accept-Encoding': 'br' } });
    const etag = first.headers.get('ETag');
    // compress() suffixed the validator with the encoding token.
    expect(etag).toContain('-br');

    const second = await fetch(`${base}/theme.css`, { headers: { 'Accept-Encoding': 'br', 'If-None-Match': etag! } });
    expect(second.status).toBe(304);
    // RFC 9110 §15.4.5: the 304 identifies the representation the client holds, not the identity one.
    expect(second.headers.get('ETag')).toBe(etag);
  });

  test('publicDir serves a range request uncompressed (206)', async () => {
    const res = await fetch(`${base}/theme.css`, { headers: { 'Accept-Encoding': 'gzip', Range: 'bytes=0-9' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Encoding')).toBeNull();
    expect(res.headers.get('Content-Range')).toContain('bytes 0-9/');
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  test('Mochi.file() responses are compressed and support conditional requests', async () => {
    const res = await fetch(`${base}/files/report.txt`, { headers: { 'Accept-Encoding': 'br' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Encoding')).toBe('br');
    expect(await res.text()).toBe('report line\n'.repeat(300));
    expect(seenKinds['/files/report.txt']).toBe('file');

    const plain = await fetch(`${base}/files/report.txt`);
    const etag = plain.headers.get('ETag');
    expect(etag).toBeTruthy();
    const revalidated = await fetch(`${base}/files/report.txt`, { headers: { 'If-None-Match': etag! } });
    expect(revalidated.status).toBe(304);
  });

  test('server-island fragments are compressed', async () => {
    const pageHtml = await (await fetch(`${base}/`)).text();
    const wrapper = [...pageHtml.matchAll(/<mochi-server-island\b[^>]*>/g)]
      .map((m) => ({ key: m[0].match(/component-name="([^"]+)"/)?.[1], token: m[0].match(/signed-props="([^"]+)"/)?.[1] }))
      .find((w) => w.key && w.token);
    expect(wrapper).toBeTruthy();

    const res = await fetch(`${base}/_mochi/island/${wrapper!.key}?props=${encodeURIComponent(wrapper!.token!)}`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Encoding')).toBe('gzip');
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test('locally-imported assets are compressed at /_mochi/asset/*', async () => {
    const res = await fetch(`${base}/_mochi/asset/logo-abc123.svg`, { headers: { 'Accept-Encoding': 'br' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(res.headers.get('Content-Encoding')).toBe('br');
    expect(await res.text()).toBe(LOGO_SVG);
    expect(seenKinds['/_mochi/asset/logo-abc123.svg']).toBe('asset');
  });

  test('already-compressed and binary media types are left alone', async () => {
    for (const [file, contentType] of [
      ['photo.png', 'image/png'],
      ['clip.mp4', 'video/mp4'],
    ] as const) {
      const res = await fetch(`${base}/${file}`, { headers: { 'Accept-Encoding': 'br, gzip' } });
      expect(res.headers.get('Content-Type')).toBe(contentType);
      expect(res.headers.get('Content-Encoding')).toBeNull();
    }
  });
});
