// Manifest v2 stores every disk path relative to the build outDir so a prebuilt
// app survives "build here, deploy there". Prove it end-to-end: build into one
// directory, move it, and boot from the new location — pages SSR, the emitted
// image asset and the copied public file both serve from disk, and the
// local-asset registry repopulates with relocated paths.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const ROBOTS_TXT = 'User-agent: *\nDisallow:\n';

describe('manifest relocation (build → move → boot)', () => {
  let fixtureDir: string;
  let buildDir: string;
  let outDir: string;
  let publicDir: string;
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
    // `build()` copies publicDir into <outDir>/public, so public files relocate
    // with the rest of the artifacts — the one category whose source also lives
    // outside outDir, and therefore the one most able to leak an absolute path.
    publicDir = path.join(fixtureDir, 'public');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(path.join(publicDir, 'robots.txt'), ROBOTS_TXT);

    buildDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-reloc-a-'));
    await build({ routes: { '/': Mochi.page(pagePath) }, development: false, outDir: buildDir, publicDir });
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
      // `publicDir` deliberately left at its default: production serves public
      // files from the manifest, never a re-scan, so the relocated copies are
      // the only thing that can answer /robots.txt here.
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
    // Guard the categories that would otherwise pass this test vacuously — an
    // empty map has no absolute paths in it either.
    expect(Object.keys(manifest.components).length).toBeGreaterThan(0);
    expect(Object.keys(manifest.clientFiles).length).toBeGreaterThan(0);
    expect(Object.keys(manifest.publicFiles ?? {})).toEqual(['/robots.txt']);
    expect(Object.keys(manifest.localImageAssets ?? {}).length).toBeGreaterThan(0);
    expect(manifest.serverIslandScript).toBeString();

    const diskPaths = [
      ...Object.values(manifest.components).map((c) => c.ssrModule),
      ...Object.values(manifest.clientFiles),
      ...Object.values(manifest.publicFiles ?? {}),
      ...Object.values(manifest.localImageAssets ?? {}).map((a) => a.diskPath),
      manifest.serverIslandScript!,
    ];
    for (const p of diskPaths) {
      expect(path.isAbsolute(p), `expected outDir-relative path, got "${p}"`).toBe(false);
      expect(p, `expected a POSIX path, got "${p}"`).not.toContain('\\');
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

  test('a copied public file serves from the relocated directory', async () => {
    const res = await fetch(`http://localhost:${server!.port}/robots.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ROBOTS_TXT);
  });

  test('the local-asset registry repopulates with paths under the new location', async () => {
    const [assetUrl] = Object.keys(manifest.localImageAssets!);
    const info = getLocalImageAsset(assetUrl!);
    expect(info).toBeDefined();
    expect(info!.diskPath.startsWith(outDir)).toBe(true);
    expect(info!.diskPath).not.toContain('.mochi-reloc-a-');
    expect(await Bun.file(info!.diskPath).exists()).toBe(true);
  });

  test('the artifact root comes from the manifest path alone', async () => {
    // The manifest and its artifacts always ship together, so `fromManifest()`
    // takes no out-dir argument — there is nothing a caller could desync. A
    // relative manifest path must land in the same place as an absolute one.
    const { ComponentRegistry } = await import('./ComponentRegistry');
    const relativeManifestPath = path.relative(process.cwd(), path.join(outDir, 'manifest.json'));
    const restored = await ComponentRegistry.fromManifest(relativeManifestPath, false);
    expect(restored.outDir).toBe(path.resolve(outDir));
    const [assetUrl] = Object.keys(manifest.localImageAssets!);
    const restoredAsset = restored.getLocalImageAssets().get(assetUrl!);
    expect(restoredAsset).toBeDefined();
    expect(await Bun.file(restoredAsset!.diskPath).exists()).toBe(true);
  });

  // Artifact layout is tied to the schema version in both directions, so the
  // runtime refuses anything but an exact match rather than half-booting and
  // failing later with a file-not-found from deep inside the loader.
  test.each([1, 99])('a version-%i manifest is rejected', async (version) => {
    const other: MochiManifest = JSON.parse(JSON.stringify(manifest));
    other.version = version;
    const otherPath = path.join(outDir, `manifest-v${version}.json`);
    writeFileSync(otherPath, JSON.stringify(other));

    const { ComponentRegistry } = await import('./ComponentRegistry');
    await expect(ComponentRegistry.fromManifest(otherPath, false)).rejects.toThrow(`is version ${version}, but this mochi-framework runtime reads version 2`);
  });
});
