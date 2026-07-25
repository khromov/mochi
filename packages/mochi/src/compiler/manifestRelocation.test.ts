// Manifest v2 stores every disk path relative to the build outDir so a prebuilt
// app survives "build here, deploy there". Prove it end-to-end: build into one
// directory, move it, and boot from the new location — pages SSR, the emitted
// image asset serves from disk, and the local-asset registry repopulates with
// relocated paths.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { getLocalImageAsset } from '../image/localAssetRegistry';
import type { MochiManifest } from '../types';

const GLOBAL_LOCAL_ASSETS_KEY = '__mochi_local_image_assets__';

// Windows can hold a just-built tree briefly after the handles into it are dropped.
const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const PAGE_SRC = `<script>
  import hero from './hero.png';
</script>
<img src={hero.src} width={hero.width} height={hero.height} alt="" />
`;

describe('manifest relocation (build → move → boot)', () => {
  let fixtureDir: string;
  let buildDir: string;
  let outDir: string;
  let pagePath: string;
  let manifest: MochiManifest;
  let server: Server<undefined> | undefined;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-reloc-fixture-'));
    const tiny = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const png = await new Bun.Image(tiny).resize(48, 24, { fit: 'fill' }).png().bytes();
    writeFileSync(path.join(fixtureDir, 'hero.png'), png);
    pagePath = path.join(fixtureDir, 'Page.svelte');
    writeFileSync(pagePath, PAGE_SRC);

    buildDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-reloc-a-'));
    await build({ routes: { '/': Mochi.page(pagePath) }, development: false, outDir: buildDir });
    // The relocation: everything the runtime needs must follow the directory.
    // Copy rather than rename — `build()` ran in this process and still holds
    // handles under buildDir (it imports the SSR entries it just emitted), and
    // Windows refuses to rename a directory a process has open handles into.
    // Copy-then-deploy is what a real deployment does anyway.
    outDir = buildDir.replace('.mochi-reloc-a-', '.mochi-reloc-b-');
    cpSync(buildDir, outDir, { recursive: true });
    // Removing the source proves the runtime never reads the build location.
    // Those same Windows handles can refuse this; the assertions below stand on
    // the manifest being relative rather than on the source being gone.
    try {
      rmSync(buildDir, RM_OPTS);
    } catch {
      // Left for afterAll, once the server has released the tree.
    }

    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
    server = await Mochi.serve({
      port: 0,
      development: false,
      warmup: false,
      logger: { enabled: false },
      outDir,
      routes: { '/': Mochi.page(pagePath) },
    });
  });

  afterAll(() => {
    server?.stop(true);
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_LOCAL_ASSETS_KEY];
    rmSync(fixtureDir, RM_OPTS);
    rmSync(outDir, RM_OPTS);
    rmSync(buildDir, RM_OPTS);
  });

  // Artifact paths only. Source paths (the `components` keys, `resolvedPath`,
  // `serverIslandPaths`) deliberately still carry whatever the route was
  // registered with — here that's absolute, since the fixture page lives in a
  // temp dir. They're lookup keys, not disk reads.
  test('manifest is v2 and contains no absolute artifact paths', () => {
    expect(manifest.version).toBe(2);
    const diskPaths = [
      ...Object.values(manifest.components).map((c) => c.ssrModule),
      ...Object.values(manifest.clientFiles),
      ...Object.values(manifest.publicFiles ?? {}),
      ...Object.values(manifest.localImageAssets ?? {}).map((a) => a.diskPath),
      ...(manifest.serverIslandScript ? [manifest.serverIslandScript] : []),
    ];
    expect(diskPaths.length).toBeGreaterThan(0);
    for (const p of diskPaths) {
      expect(path.isAbsolute(p), `expected outDir-relative path, got "${p}"`).toBe(false);
    }
  });

  test('page SSRs from the relocated build with the imported image', async () => {
    const res = await fetch(`http://localhost:${server!.port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<img src="\/_mochi\/asset\/hero-[a-z0-9]+\.png" width="48" height="24"/);
  });

  test('the emitted image asset serves from the relocated directory', async () => {
    const [assetUrl] = Object.keys(manifest.localImageAssets!);
    const res = await fetch(`http://localhost:${server!.port}${assetUrl}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect((await res.bytes()).length).toBeGreaterThan(0);
  });

  test('the local-asset registry repopulates with paths under the new location', async () => {
    const [assetUrl] = Object.keys(manifest.localImageAssets!);
    const info = getLocalImageAsset(assetUrl!);
    expect(info).toBeDefined();
    expect(info!.diskPath.startsWith(outDir)).toBe(true);
    expect(info!.diskPath).not.toContain('.mochi-reloc-a-');
    expect(await Bun.file(info!.diskPath).exists()).toBe(true);
  });

  test('v2 paths resolve against the manifest directory, not the passed outDir', async () => {
    // The manifest and its artifacts always ship together, so a mismatched
    // `outDir` (e.g. the default './.mochi' alongside an explicit `manifest`)
    // must not be able to send the loader looking in the wrong place.
    const { ComponentRegistry } = await import('./ComponentRegistry');
    const restored = await ComponentRegistry.fromManifest(path.join(outDir, 'manifest.json'), false, path.join(outDir, 'does-not-exist'));
    const [assetUrl] = Object.keys(manifest.localImageAssets!);
    const restoredAsset = restored.getLocalImageAssets().get(assetUrl!);
    expect(restoredAsset).toBeDefined();
    expect(await Bun.file(restoredAsset!.diskPath).exists()).toBe(true);
  });

  test('v1 manifests with absolute paths still resolve as-is', async () => {
    // Simulate a pre-v2 manifest: absolute ssrModule/diskPath, cwd-relative not exercised.
    const v1: MochiManifest = JSON.parse(JSON.stringify(manifest));
    v1.version = 1;
    for (const entry of Object.values(v1.components)) {
      entry.ssrModule = path.resolve(outDir, entry.ssrModule);
    }
    for (const [urlPath, diskPath] of Object.entries(v1.clientFiles)) {
      v1.clientFiles[urlPath] = path.resolve(outDir, diskPath);
    }
    if (v1.publicFiles) {
      for (const [urlPath, diskPath] of Object.entries(v1.publicFiles)) {
        v1.publicFiles[urlPath] = path.resolve(outDir, diskPath);
      }
    }
    for (const asset of Object.values(v1.localImageAssets ?? {})) {
      asset.diskPath = path.resolve(outDir, asset.diskPath);
    }
    if (v1.serverIslandScript) {
      v1.serverIslandScript = path.resolve(outDir, v1.serverIslandScript);
    }
    const v1Path = path.join(outDir, 'manifest-v1.json');
    writeFileSync(v1Path, JSON.stringify(v1));

    const { ComponentRegistry } = await import('./ComponentRegistry');
    const restored = await ComponentRegistry.fromManifest(v1Path, false, outDir);
    const [assetUrl] = Object.keys(v1.localImageAssets!);
    const restoredAsset = restored.getLocalImageAssets().get(assetUrl!);
    expect(restoredAsset).toBeDefined();
    expect(await Bun.file(restoredAsset!.diskPath).exists()).toBe(true);
  });
});
