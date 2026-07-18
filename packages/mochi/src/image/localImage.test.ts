import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localImage } from './localImage';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_DIRS_KEY = '__mochi_local_dirs__';
const GLOBAL_META_KEY = '__mochi_local_dir_meta__';

function installConfig(options: Record<string, unknown>): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

const dirs: string[] = [];

afterEach(() => {
  for (const key of [GLOBAL_CONFIG_KEY, GLOBAL_DIRS_KEY, GLOBAL_META_KEY]) {
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

describe('localImage', () => {
  async function setup(entry?: unknown) {
    const root = mkdtempSync(join(tmpdir(), 'mochi-localimage-'));
    dirs.push(root);
    installConfig({ localDirs: { media: entry ?? root } });
    await Bun.write(join(root, 'pic.png'), PNG_64);
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
    await expect(localImage('other/pic.png')).rejects.toThrow(/localDirs \("media"\)/);
    await expect(localImage('media/missing.png')).rejects.toThrow(/file not found/);
  });

  test('rejects a non-raster extension even though the general layer would serve it', async () => {
    const root = await setup();
    await Bun.write(join(root, 'notes.txt'), 'hello');
    await expect(localImage('media/notes.txt')).rejects.toThrow(/raster-image extension/);
  });

  test('rejects a raster under a dot-directory unless the dir opts into dotfiles', async () => {
    const root = await setup();
    mkdirSync(join(root, '.hidden'));
    await Bun.write(join(root, '.hidden', 'pic.png'), PNG_64);
    await expect(localImage('media/.hidden/pic.png')).rejects.toThrow(/includeDotfiles/);
    installConfig({ localDirs: { media: { root, includeDotfiles: true } } });
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_DIRS_KEY];
    expect((await localImage('media/.hidden/pic.png')).width).toBe(64);
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
