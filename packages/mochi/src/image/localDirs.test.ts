import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFilesHandler, localImage, resolveLocalDirFile } from './localDirs';
import { resolveImageOptions } from './config';
import { toPosixPath } from '../utils';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_RUNTIME_KEY = '__mochi_image_runtime__';
const GLOBAL_META_KEY = '__mochi_local_dir_meta__';

function installConfig(options: Record<string, unknown> = {}): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

// Installs the image runtime directly (bypassing getImageRuntime()'s lazy
// getMochiConfig() read), mirroring imageApi.test.ts.
function installRuntime(imageOptions: Record<string, unknown>): void {
  const resolved = resolveImageOptions(imageOptions);
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY] = { options: resolved, cache: undefined };
}

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_META_KEY];
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// A tiny valid PNG, resized to give tests a real decodable source (same
// fixture approach as imageApi.test.ts).
const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
let PNG_64: Uint8Array<ArrayBuffer>;
let PNG_128x64: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  PNG_64 = new Uint8Array(await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes());
  PNG_128x64 = new Uint8Array(await new Bun.Image(PNG_1x1).resize(128, 64, { fit: 'fill' }).png().bytes());
});

describe('resolveLocalDirFile', () => {
  test('resolves a nested path inside a configured root with the right content type', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    const hit = resolveLocalDirFile('/_mochi/files/media/sub/cat.png', { media: root });
    expect(hit).toBeDefined();
    expect(toPosixPath(hit!.diskPath)).toBe(toPosixPath(join(root, 'sub/cat.png')));
    expect(hit!.contentType).toBe('image/png');
    expect(resolveLocalDirFile('/_mochi/files/media/photo.JPG', { media: root })?.contentType).toBe('image/jpeg');
  });

  test('honors a custom assetPrefix', () => {
    installConfig({ assetPrefix: '/custom' });
    const root = tempDir('mochi-localdirs-');
    expect(resolveLocalDirFile('/custom/files/media/cat.png', { media: root })).toBeDefined();
    expect(resolveLocalDirFile('/_mochi/files/media/cat.png', { media: root })).toBeUndefined();
  });

  test.each([
    ['unknown dir name', '/_mochi/files/other/cat.png'],
    ['no relative path', '/_mochi/files/media'],
    ['empty relative path', '/_mochi/files/media/'],
    ['non-image extension', '/_mochi/files/media/notes.txt'],
    ['plain ../ traversal', '/_mochi/files/media/../escape.png'],
    ['encoded ../ traversal', '/_mochi/files/media/%2e%2e%2fescape.png'],
    ['double-encoded null byte', '/_mochi/files/media/a%00.png'],
    ['prototype-chain dir name', '/_mochi/files/constructor/cat.png'],
    ['outside the files prefix', '/_mochi/asset/cat.png'],
  ])('rejects %s', (_label, pathname) => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    expect(resolveLocalDirFile(pathname, { media: root })).toBeUndefined();
  });

  test('a ../ chain cannot escape into a sibling directory', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    const other = tempDir('mochi-localdirs-other-');
    const escape = `/_mochi/files/media/${encodeURIComponent(`../${other.split('/').pop()}/secret.png`)}`;
    expect(resolveLocalDirFile(escape, { media: root, other })).toBeUndefined();
  });
});

describe('createLocalFilesHandler', () => {
  async function setup(development: boolean) {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    mkdirSync(join(root, 'sub'));
    await Bun.write(join(root, 'sub', 'pic.png'), PNG_64);
    installRuntime({ localDirs: { media: root } });
    return { root, handler: createLocalFilesHandler(development) };
  }

  test('serves bytes with revalidation headers in production', async () => {
    const { handler } = await setup(false);
    const res = await handler(new Request('http://localhost/_mochi/files/media/sub/pic.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('Last-Modified')).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_64);
  });

  test('replies 304 to a fresh If-Modified-Since and 200 to a stale one', async () => {
    const { root, handler } = await setup(false);
    const first = await handler(new Request('http://localhost/_mochi/files/media/sub/pic.png'));
    const lastModified = first.headers.get('Last-Modified')!;
    const fresh = await handler(new Request('http://localhost/_mochi/files/media/sub/pic.png', { headers: { 'If-Modified-Since': lastModified } }));
    expect(fresh.status).toBe(304);
    // Bump the file's mtime past the client's snapshot → full 200 again.
    const later = new Date(Date.parse(lastModified) + 2_000);
    utimesSync(join(root, 'sub', 'pic.png'), later, later);
    const stale = await handler(new Request('http://localhost/_mochi/files/media/sub/pic.png', { headers: { 'If-Modified-Since': lastModified } }));
    expect(stale.status).toBe(200);
  });

  test('sends no cache headers in development', async () => {
    const { handler } = await setup(true);
    const res = await handler(new Request('http://localhost/_mochi/files/media/sub/pic.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBeNull();
    expect(res.headers.get('Last-Modified')).toBeNull();
  });

  test('404s a missing file and a traversal attempt', async () => {
    const { handler } = await setup(false);
    expect((await handler(new Request('http://localhost/_mochi/files/media/nope.png'))).status).toBe(404);
    expect((await handler(new Request('http://localhost/_mochi/files/media/%2e%2e%2fpic.png'))).status).toBe(404);
  });
});

describe('localImage', () => {
  async function setup() {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    await Bun.write(join(root, 'pic.png'), PNG_64);
    installRuntime({ localDirs: { media: root } });
    return root;
  }

  test('returns the ImportedImage shape for a configured-dir file', async () => {
    await setup();
    const img = await localImage('media/pic.png');
    expect(img).toEqual({ src: '/_mochi/files/media/pic.png', width: 64, height: 64, format: 'png' });
  });

  test('tolerates a leading slash', async () => {
    await setup();
    expect((await localImage('/media/pic.png')).src).toBe('/_mochi/files/media/pic.png');
  });

  test('URL-encodes path segments in the returned src', async () => {
    const root = await setup();
    await Bun.write(join(root, 'my pic.png'), PNG_64);
    expect((await localImage('media/my pic.png')).src).toBe('/_mochi/files/media/my%20pic.png');
  });

  test('throws a helpful error for an unknown dir and for a missing file', async () => {
    await setup();
    await expect(localImage('other/pic.png')).rejects.toThrow(/image\.localDirs \("media"\)/);
    await expect(localImage('media/missing.png')).rejects.toThrow(/file not found/);
  });

  test('throws on a file whose extension lies about its contents', async () => {
    const root = await setup();
    await Bun.write(join(root, 'fake.png'), 'not an image at all');
    await expect(localImage('media/fake.png')).rejects.toThrow(/could not be decoded/);
  });

  test('re-probes when the file is replaced, serves cached metadata when unchanged', async () => {
    const root = await setup();
    expect(await localImage('media/pic.png')).toMatchObject({ width: 64, height: 64 });
    expect(await localImage('media/pic.png')).toMatchObject({ width: 64, height: 64 });
    await Bun.write(join(root, 'pic.png'), PNG_128x64);
    expect(await localImage('media/pic.png')).toMatchObject({ width: 128, height: 64 });
  });
});
