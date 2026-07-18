import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageAssetLoader, IMAGE_FILE_FILTER } from './imageAssetLoader';
import { getLocalImageAsset } from '../image/localAssetRegistry';
import { toPosixPath } from '../utils';
import { initExtensions } from '../extensions';
import type { MochiHookContext } from '../extensions';
import type { LocalImageAsset } from '../image/types';

const GLOBAL_KEY = '__mochi_local_image_assets__';
const dirs: string[] = [];

// Real raster bytes so Bun.Image can decode/probe them.
let PNG_40x30: Uint8Array;
beforeAll(async () => {
  const tiny = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  PNG_40x30 = await new Bun.Image(tiny).resize(40, 30, { fit: 'fill' }).png().bytes();
});

function mkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-imgloader-'));
  dirs.push(dir);
  return dir;
}

function writeFixture(dir: string, name: string, bytes: Uint8Array | string): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

// Parse the `export default {...};` module the loader returns.
function parseModule(contents: string): { src: string; width: number; height: number; format: string } {
  const json = contents.replace(/^export default /, '').replace(/;\s*$/, '');
  return JSON.parse(json);
}

afterEach(() => {
  initExtensions({});
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('IMAGE_FILE_FILTER', () => {
  test('matches raster extensions, not svg or others', () => {
    for (const f of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.avif', 'a.gif', 'a.JPG']) {
      expect(IMAGE_FILE_FILTER.test(f)).toBe(true);
    }
    for (const f of ['a.svg', 'a.css', 'a.ts', 'a.mp4']) {
      expect(IMAGE_FILE_FILTER.test(f)).toBe(false);
    }
  });
});

describe('createImageAssetLoader', () => {
  test('returns the ImportedImage object with correct metadata + writes the asset', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const fixture = writeFixture(dir, 'hero.png', PNG_40x30);
    const assets = new Map<string, LocalImageAsset>();
    const loader = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets });

    const result = await loader({ path: fixture });
    expect(result.loader).toBe('js');
    const obj = parseModule(result.contents);
    expect(obj.width).toBe(40);
    expect(obj.height).toBe(30);
    expect(obj.format).toBe('png');
    expect(obj.src).toMatch(/^\/_mochi\/asset\/hero-[a-z0-9]+\.png$/);

    // File emitted under <outDir>/assets and registered in both maps.
    const asset = assets.get(obj.src);
    expect(asset).toBeDefined();
    expect(existsSync(asset!.diskPath)).toBe(true);
    expect(asset!.contentType).toBe('image/png');
    // The build map stores a POSIX disk path (for the manifest); the global
    // registry stores the native path (for Bun.file). Compare separator-insensitively.
    const registered = getLocalImageAsset(obj.src);
    expect(registered?.contentType).toBe('image/png');
    expect(registered && toPosixPath(registered.diskPath)).toBe(asset!.diskPath);
  });

  test('is content-addressed: same bytes → same url, idempotent write', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const a = writeFixture(dir, 'one.png', PNG_40x30);
    const b = writeFixture(dir, 'one-copy.png', PNG_40x30);
    const assets = new Map<string, LocalImageAsset>();
    const loader = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets });

    const ra = parseModule((await loader({ path: a })).contents);
    const rb = parseModule((await loader({ path: b })).contents);
    // Same bytes → same hash. Different stems → different slug, so the URLs differ
    // by name but share the hash suffix.
    expect(ra.src.split('-').pop()).toBe(rb.src.split('-').pop());

    // Re-running the same import is idempotent (no throw, same url).
    const again = parseModule((await loader({ path: a })).contents);
    expect(again.src).toBe(ra.src);
  });

  test('rejectUnknown: throws for an image not already in the assets map, without writing or registering', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const fixture = writeFixture(dir, 'new.png', PNG_40x30);
    const assets = new Map<string, LocalImageAsset>();
    const loader = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets, rejectUnknown: true });

    await expect(loader({ path: fixture })).rejects.toThrow(/runtime in production|not part of the prebuilt manifest/i);
    // Nothing registered in either map, and no asset emitted to disk.
    expect(assets.size).toBe(0);
    expect(existsSync(join(outDir, 'assets'))).toBe(false);
  });

  test('rejectUnknown: passes through when the url is already registered (manifest-restored asset)', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const fixture = writeFixture(dir, 'known.png', PNG_40x30);
    const assets = new Map<string, LocalImageAsset>();

    // First a normal (build-time) pass to learn the content-hashed url, mimicking
    // what fromManifest repopulates into the shared assets map.
    const built = parseModule((await createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets })({ path: fixture })).contents);

    // A prod on-demand recompile of the same built image must succeed idempotently.
    const guarded = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets, rejectUnknown: true });
    const again = parseModule((await guarded({ path: fixture })).contents);
    expect(again.src).toBe(built.src);
  });

  test('rejects an undecodable/SVG file with a clear error', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const svg = writeFixture(dir, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    const loader = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets: new Map() });
    await expect(loader({ path: svg })).rejects.toThrow(/could not be decoded|unsupported format/i);
  });
});

describe('image extension points', () => {
  test('image:localAssetFilename rewrites the emitted filename + diskPath', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const fixture = writeFixture(dir, 'hero.png', PNG_40x30);
    initExtensions({
      filters: {
        'image:localAssetFilename': (name, ctx) => {
          expect(ctx.sourcePath).toBe(fixture);
          expect(ctx.ext).toBe('png');
          expect(ctx.format).toBe('png');
          return `custom-${name}`;
        },
      },
    });
    const assets = new Map<string, LocalImageAsset>();
    const loader = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets });
    const obj = parseModule((await loader({ path: fixture })).contents);

    expect(obj.src).toMatch(/^\/_mochi\/asset\/custom-hero-[a-z0-9]+\.png$/);
    const asset = assets.get(obj.src);
    expect(asset!.diskPath).toContain('/assets/custom-hero-');
    expect(existsSync(asset!.diskPath)).toBe(true);
  });

  test('image:localAssetUrl rewrites the served src and the registry key', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const fixture = writeFixture(dir, 'hero.png', PNG_40x30);
    initExtensions({
      filters: {
        'image:localAssetUrl': (url, ctx) => {
          expect(url).toBe(`/_mochi/asset/${ctx.filename}`);
          expect(ctx.assetPrefix).toBe('/_mochi');
          return `https://cdn.example.com/${ctx.filename}`;
        },
      },
    });
    const assets = new Map<string, LocalImageAsset>();
    const loader = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets });
    const obj = parseModule((await loader({ path: fixture })).contents);

    expect(obj.src).toMatch(/^https:\/\/cdn\.example\.com\/hero-[a-z0-9]+\.png$/);
    // The rewritten URL is the key in both the build map and the request-time registry.
    expect(assets.get(obj.src)).toBeDefined();
    expect(getLocalImageAsset(obj.src)).toBeDefined();
  });

  test('image:localAssetEmitted fires once with the asset context', async () => {
    const dir = mkdir();
    const outDir = mkdir();
    const fixture = writeFixture(dir, 'hero.png', PNG_40x30);
    const emitted: MochiHookContext['image:localAssetEmitted'][] = [];
    initExtensions({
      eventHooks: {
        'image:localAssetEmitted': (ctx) => {
          emitted.push(ctx);
        },
      },
    });
    const loader = createImageAssetLoader({ outDir, assetPrefix: '/_mochi', assets: new Map() });
    const obj = parseModule((await loader({ path: fixture })).contents);

    expect(emitted).toHaveLength(1);
    const ctx = emitted[0]!;
    expect(ctx.sourcePath).toBe(fixture);
    expect(ctx.url).toBe(obj.src);
    expect(ctx.width).toBe(40);
    expect(ctx.height).toBe(30);
    expect(ctx.format).toBe('png');
    expect(ctx.contentType).toBe('image/png');
    expect(existsSync(ctx.diskPath)).toBe(true);

    // Re-processing the same file (as the SSR + client passes do) hits the same
    // content-addressed disk path, skips the write → the hook does not re-fire.
    await loader({ path: fixture });
    expect(emitted).toHaveLength(1);
  });
});
