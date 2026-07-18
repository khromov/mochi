import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getImageUrl, localImage } from './image/imageApi';

// End-to-end coverage of runtime local dirs (`image.localDirs`): path-addressed
// serving, revalidation, files written AFTER boot, and the transform pipeline
// reading a local-dir source.
describe('image.localDirs serving', () => {
  let server: Server<undefined>;
  let outDir: string;
  let mediaDir: string;
  let base: string;

  const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  let PNG_64: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    PNG_64 = new Uint8Array(await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes());
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-localdirs-out-'));
    mediaDir = mkdtempSync(path.join(tmpdir(), 'mochi-localdirs-serve-'));
    mkdirSync(path.join(mediaDir, 'sub'));
    await Bun.write(path.join(mediaDir, 'sub', 'photo.png'), PNG_64);

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      image: {
        localDirs: { media: mediaDir },
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
  });

  test('serves a nested file with revalidation headers and exact bytes', async () => {
    const res = await fetch(`${base}/_mochi/files/media/sub/photo.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('last-modified')).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_64);
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

  test('404s traversal, unknown dirs, and non-image extensions', async () => {
    await Bun.write(path.join(mediaDir, 'notes.txt'), 'hi');
    expect((await fetch(`${base}/_mochi/files/media/%2e%2e%2fescape.png`)).status).toBe(404);
    expect((await fetch(`${base}/_mochi/files/other/photo.png`)).status).toBe(404);
    expect((await fetch(`${base}/_mochi/files/media/notes.txt`)).status).toBe(404);
  });
});
