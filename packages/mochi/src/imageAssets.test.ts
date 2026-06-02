import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'image-imports');
const FIXTURE_PAGE = path.join(FIXTURE_DIR, 'Page.svelte');
const FIXTURE_IMAGE = path.join(FIXTURE_DIR, 'pixel.png');

describe('image imports', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-image-import-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('resolves the import to a /_mochi/asset/ URL, not a bare disk path', () => {
    const ssrSource = readFileSync(path.join(outDir, 'svelte-compile', 'Page.server.js'), 'utf8');
    expect(ssrSource).toMatch(/\/_mochi\/asset\/pixel-[a-z0-9]+\.png/);
    expect(ssrSource).not.toContain('./pixel.png');
  });

  test('getAssetFile() returns a readable path with the original bytes', () => {
    const assets = registry.toManifest().assets ?? {};
    const urlPath = Object.keys(assets).find((u) => u.includes('/asset/pixel-'));
    expect(urlPath).toBeDefined();

    const diskPath = registry.getAssetFile(urlPath!);
    expect(diskPath).toBeDefined();
    expect(readFileSync(diskPath!)).toEqual(readFileSync(FIXTURE_IMAGE));
  });

  test('the URL is content-addressed (hash derives from the bytes)', () => {
    const assets = registry.toManifest().assets ?? {};
    const urlPath = Object.keys(assets)[0]!;
    const expected = `/_mochi/asset/pixel-${Bun.hash(readFileSync(FIXTURE_IMAGE)).toString(36)}.png`;
    expect(urlPath).toBe(expected);
  });

  test('manifest round-trip preserves the asset map and getAssetFile()', async () => {
    const manifest = registry.toManifest();
    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(manifest));
    const restored = await ComponentRegistry.fromManifest(manifestPath, false, outDir);
    const urlPath = Object.keys(manifest.assets ?? {})[0]!;
    expect(restored.getAssetFile(urlPath)).toBeDefined();
    // Path is derived from outDir (like clientFiles), so it's portable: relative
    // when the build passes a relative outDir, never the absolute assetOutDir.
    expect(manifest.assets![urlPath]).toBe(path.join(outDir, 'svelte-assets', path.basename(urlPath)));
  });
});
