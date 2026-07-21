import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { getLocalImageAsset } from '../image/localAssetRegistry';

const GLOBAL_LOCAL_ASSETS_KEY = '__mochi_local_image_assets__';

// A page that imports a local image and uses its object fields.
const PAGE_SRC = `<script>
  import hero from './hero.png';
</script>
<img src={hero.src} width={hero.width} height={hero.height} alt="" />
`;

describe('local image import through the compiler', () => {
  let fixtureDir: string;
  let outDir: string;
  let pagePath: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-img-import-fix-'));
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-img-import-out-'));
    // Real 48x24 PNG so Bun.Image can probe it.
    const tiny = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const png = await new Bun.Image(tiny).resize(48, 24, { fit: 'fill' }).png().bytes();
    writeFileSync(path.join(fixtureDir, 'hero.png'), png);
    pagePath = path.join(fixtureDir, 'Page.svelte');
    writeFileSync(pagePath, PAGE_SRC);

    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(pagePath);
  });

  afterAll(() => {
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_LOCAL_ASSETS_KEY];
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  test('populates getLocalImageAssets() with correct metadata', () => {
    const assets = registry.getLocalImageAssets();
    expect(assets.size).toBe(1);
    const [url, asset] = [...assets.entries()][0]!;
    expect(url).toMatch(/^\/_mochi\/asset\/hero-[a-z0-9]+\.png$/);
    expect(asset.width).toBe(48);
    expect(asset.height).toBe(24);
    expect(asset.format).toBe('png');
    expect(asset.contentType).toBe('image/png');
  });

  test('round-trips through toManifest / fromManifest and repopulates the global registry', async () => {
    const manifest = registry.toManifest();
    expect(manifest.localImageAssets).toBeDefined();
    const [url] = Object.keys(manifest.localImageAssets!);
    expect(url).toBeDefined();

    const manifestPath = path.join(outDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    // Clear the global registry so we prove fromManifest repopulates it.
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_LOCAL_ASSETS_KEY];
    expect(getLocalImageAsset(url!)).toBeUndefined();

    const restored = await ComponentRegistry.fromManifest(manifestPath, false, outDir);
    expect(restored.getLocalImageAssets().has(url!)).toBe(true);
    const info = getLocalImageAsset(url!);
    expect(info).toBeDefined();
    expect(info!.contentType).toBe('image/png');
  });
});
