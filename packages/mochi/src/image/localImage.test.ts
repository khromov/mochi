import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localImage, resolveStaticDirImage } from './localImage';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_MOUNTS_KEY = '__mochi_static_image_mounts__';
const GLOBAL_META_KEY = '__mochi_static_image_meta__';

function installConfig(options: Record<string, unknown>): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_MOUNTS_KEY];
}

const dirs: string[] = [];

afterEach(() => {
  for (const key of [GLOBAL_CONFIG_KEY, GLOBAL_MOUNTS_KEY, GLOBAL_META_KEY]) {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  }
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// A tiny valid PNG, resized to give tests a real decodable source (same
// fixture approach as imageApi.test.ts).
const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
let PNG_64: Uint8Array;
let PNG_128x64: Uint8Array;
beforeAll(async () => {
  PNG_64 = await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes();
  PNG_128x64 = await new Bun.Image(PNG_1x1).resize(128, 64, { fit: 'fill' }).png().bytes();
});

async function setup(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'mochi-localimage-'));
  dirs.push(root);
  installConfig({ staticDirs: { '/media': root } });
  await Bun.write(join(root, 'pic.png'), PNG_64);
  return root;
}

describe('localImage', () => {
  test('returns the ImportedImage shape for a file under a staticDirs mount', async () => {
    await setup();
    expect(await localImage('/media/pic.png')).toEqual({ src: '/media/pic.png', width: 64, height: 64, format: 'png' });
  });

  test('URL-encodes path segments in the returned src, and accepts an already-encoded path', async () => {
    const root = await setup();
    await Bun.write(join(root, 'my pic.png'), PNG_64);
    expect((await localImage('/media/my pic.png')).src).toBe('/media/my%20pic.png');
    expect((await localImage('/media/my%20pic.png')).src).toBe('/media/my%20pic.png');
  });

  test('throws a helpful error for an unmounted prefix and for a missing file', async () => {
    await setup();
    await expect(localImage('/other/pic.png')).rejects.toThrow(/"\/media"/);
    await expect(localImage('/media/missing.png')).rejects.toThrow(/file not found/);
  });

  test('rejects a non-raster extension even though the mount serves it', async () => {
    const root = await setup();
    await Bun.write(join(root, 'notes.txt'), 'hello');
    await expect(localImage('/media/notes.txt')).rejects.toThrow(/raster-image extension/);
  });

  test('rejects a traversal that would escape the mounted root', async () => {
    const root = await setup();
    await Bun.write(join(root, '..', 'outside.png'), PNG_64);
    expect(resolveStaticDirImage('/media/../outside.png')).toBeUndefined();
    await expect(localImage('/media/../outside.png')).rejects.toThrow(/not an image served by a staticDirs mount/);
    rmSync(join(root, '..', 'outside.png'), { force: true });
  });

  test('throws on a file whose extension lies about its contents', async () => {
    const root = await setup();
    await Bun.write(join(root, 'fake.png'), 'not an image at all');
    await expect(localImage('/media/fake.png')).rejects.toThrow(/could not be decoded/);
  });

  test('re-probes when the file is replaced, serves cached metadata when unchanged', async () => {
    const root = await setup();
    expect(await localImage('/media/pic.png')).toMatchObject({ width: 64, height: 64 });
    expect(await localImage('/media/pic.png')).toMatchObject({ width: 64, height: 64 });
    await Bun.write(join(root, 'pic.png'), PNG_128x64);
    expect(await localImage('/media/pic.png')).toMatchObject({ width: 128, height: 64 });
  });

  test('resolves against the longest matching prefix when one mount nests inside another', async () => {
    const outer = mkdtempSync(join(tmpdir(), 'mochi-localimage-outer-'));
    const inner = mkdtempSync(join(tmpdir(), 'mochi-localimage-inner-'));
    dirs.push(outer, inner);
    installConfig({ staticDirs: { '/media': outer, '/media/nested': inner } });
    await Bun.write(join(inner, 'pic.png'), PNG_128x64);
    expect(await localImage('/media/nested/pic.png')).toMatchObject({ src: '/media/nested/pic.png', width: 128 });
  });

  test('resolves nothing when no staticDirs are configured', async () => {
    installConfig({});
    expect(resolveStaticDirImage('/media/pic.png')).toBeUndefined();
  });
});
