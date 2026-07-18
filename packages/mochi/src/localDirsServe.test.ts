import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getImageUrl, localImage } from './image/imageApi';
import { localFile, localFileBytes } from './runtime/localDirs';

// End-to-end coverage of runtime local dirs (`localDirs`): path-addressed
// serving of any file type, revalidation, native Range support, dotfile
// policy, files written AFTER boot, and the transform pipeline reading a
// local-dir source.
describe('localDirs serving', () => {
  let server: Server<undefined>;
  let outDir: string;
  let mediaDir: string;
  let secretsDir: string;
  let base: string;

  const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  let PNG_64: Uint8Array<ArrayBuffer>;
  const TXT_BODY = 'hello from a local dir\n';

  beforeAll(async () => {
    PNG_64 = new Uint8Array(await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes());
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-localdirs-out-'));
    mediaDir = mkdtempSync(path.join(tmpdir(), 'mochi-localdirs-serve-'));
    secretsDir = mkdtempSync(path.join(tmpdir(), 'mochi-localdirs-secrets-'));
    mkdirSync(path.join(mediaDir, 'sub'));
    await Bun.write(path.join(mediaDir, 'sub', 'photo.png'), PNG_64);
    await Bun.write(path.join(mediaDir, 'notes.txt'), TXT_BODY);
    await Bun.write(path.join(mediaDir, 'archive.zip'), 'PK\x03\x04fake');
    await Bun.write(path.join(mediaDir, '.env'), 'SECRET=1');
    await Bun.write(path.join(secretsDir, '.env'), 'SECRET=2');

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      localDirs: { media: mediaDir, secrets: { root: secretsDir, includeDotfiles: true } },
      image: {
        sizes: { thumb: { width: 8, height: 8, fit: 'fill' } },
      },
      routes: {},
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(mediaDir, { recursive: true, force: true });
    rmSync(secretsDir, { recursive: true, force: true });
  });

  test('serves a nested file with revalidation headers and exact bytes', async () => {
    const res = await fetch(`${base}/_mochi/files/media/sub/photo.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('last-modified')).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_64);
  });

  test('serves non-image types with extension-derived content types', async () => {
    const txt = await fetch(`${base}/_mochi/files/media/notes.txt`);
    expect(txt.status).toBe(200);
    expect(txt.headers.get('content-type')).toBe('text/plain;charset=utf-8');
    expect(await txt.text()).toBe(TXT_BODY);
    const zip = await fetch(`${base}/_mochi/files/media/archive.zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toBe('application/zip');
  });

  test('answers Range requests natively (206 partial, 416 unsatisfiable)', async () => {
    const partial = await fetch(`${base}/_mochi/files/media/notes.txt`, { headers: { Range: 'bytes=0-4' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 0-4/${TXT_BODY.length}`);
    expect(partial.headers.get('accept-ranges')).toBe('bytes');
    expect(await partial.text()).toBe(TXT_BODY.slice(0, 5));
    const bad = await fetch(`${base}/_mochi/files/media/notes.txt`, { headers: { Range: 'bytes=999999-' } });
    expect(bad.status).toBe(416);
  });

  test('replies 304 to a conditional request', async () => {
    const first = await fetch(`${base}/_mochi/files/media/sub/photo.png`);
    const res = await fetch(`${base}/_mochi/files/media/sub/photo.png`, {
      headers: { 'If-Modified-Since': first.headers.get('last-modified')! },
    });
    expect(res.status).toBe(304);
  });

  test('serves a file written after the server booted — no restart, no registration', async () => {
    await Bun.write(path.join(mediaDir, 'late.png'), PNG_64);
    const res = await fetch(`${base}/_mochi/files/media/late.png`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_64);
  });

  test('refuses dotfiles by default; includeDotfiles: true opts a dir in', async () => {
    expect((await fetch(`${base}/_mochi/files/media/.env`)).status).toBe(404);
    const opted = await fetch(`${base}/_mochi/files/secrets/.env`);
    expect(opted.status).toBe(200);
    expect(await opted.text()).toBe('SECRET=2');
  });

  test('localFile returns a fetchable url + metadata; localFileBytes matches', async () => {
    const f = await localFile('media/notes.txt');
    expect(f).toMatchObject({ url: '/_mochi/files/media/notes.txt', size: TXT_BODY.length, contentType: 'text/plain;charset=utf-8' });
    const res = await fetch(`${base}${f.url}`);
    expect(await res.text()).toBe(TXT_BODY);
    expect(new TextDecoder().decode(await localFileBytes('media/notes.txt'))).toBe(TXT_BODY);
  });

  test('localImage + getImageUrl: a local-dir source flows through the transform endpoint', async () => {
    const img = await localImage('media/sub/photo.png');
    expect(img).toMatchObject({ src: '/_mochi/files/media/sub/photo.png', width: 64, height: 64, format: 'png' });
    const url = getImageUrl(img.src, 'thumb');
    expect(url).toStartWith('/_mochi/image/');
    const res = await fetch(`${base}${url}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const out = await new Bun.Image(new Uint8Array(await res.arrayBuffer())).metadata();
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
  });

  test('a non-raster file cannot be a transform source even though the route serves it', async () => {
    const url = getImageUrl('/_mochi/files/media/archive.zip', 'thumb');
    const res = await fetch(`${base}${url}`);
    expect(res.status).not.toBe(200);
  });

  test('404s traversal and unknown dirs', async () => {
    expect((await fetch(`${base}/_mochi/files/media/%2e%2e%2fescape.png`)).status).toBe(404);
    expect((await fetch(`${base}/_mochi/files/other/photo.png`)).status).toBe(404);
  });
});
