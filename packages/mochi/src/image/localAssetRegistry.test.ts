import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerLocalImageAsset, getLocalImageAsset, createLocalAssetHandler } from './localAssetRegistry';

const GLOBAL_KEY = '__mochi_local_image_assets__';

const dirs: string[] = [];

function writeAsset(name: string, bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-localassetreg-'));
  dirs.push(dir);
  const diskPath = join(dir, name);
  writeFileSync(diskPath, bytes);
  return diskPath;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

describe('local image asset registry', () => {
  test('register / get round-trip', () => {
    expect(getLocalImageAsset('/_mochi/asset/x-1.png')).toBeUndefined();
    registerLocalImageAsset('/_mochi/asset/x-1.png', { diskPath: '/tmp/x.png', contentType: 'image/png' });
    expect(getLocalImageAsset('/_mochi/asset/x-1.png')).toEqual({ diskPath: '/tmp/x.png', contentType: 'image/png' });
    expect(getLocalImageAsset('/_mochi/asset/missing.png')).toBeUndefined();
  });
});

describe('createLocalAssetHandler', () => {
  test('serves the bytes with content-type + nosniff, immutable Cache-Control in prod', async () => {
    const diskPath = writeAsset('hero.png', PNG);
    registerLocalImageAsset('/_mochi/asset/hero-abc.png', { diskPath, contentType: 'image/png' });
    const handler = createLocalAssetHandler(false);
    const res = await handler(new Request('http://localhost/_mochi/asset/hero-abc.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test('omits Cache-Control in development', async () => {
    const diskPath = writeAsset('hero.png', PNG);
    registerLocalImageAsset('/_mochi/asset/hero-dev.png', { diskPath, contentType: 'image/png' });
    const handler = createLocalAssetHandler(true);
    const res = await handler(new Request('http://localhost/_mochi/asset/hero-dev.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  test('404s an unregistered filename (never reads outside the registry)', async () => {
    const handler = createLocalAssetHandler(false);
    const res = await handler(new Request('http://localhost/_mochi/asset/does-not-exist.png'));
    expect(res.status).toBe(404);
  });

  test('404s a registered URL whose file is gone from disk', async () => {
    const diskPath = writeAsset('gone.png', PNG);
    rmSync(diskPath);
    registerLocalImageAsset('/_mochi/asset/gone-abc.png', { diskPath, contentType: 'image/png' });
    const handler = createLocalAssetHandler(false);
    const res = await handler(new Request('http://localhost/_mochi/asset/gone-abc.png'));
    expect(res.status).toBe(404);
  });

  test('a path-traversal attempt just misses the map and 404s', async () => {
    const handler = createLocalAssetHandler(false);
    // The pathname is only ever a map key, never joined to disk, so this can't escape.
    const res = await handler(new Request('http://localhost/_mochi/asset/..%2f..%2fetc%2fpasswd'));
    expect(res.status).toBe(404);
  });
});
