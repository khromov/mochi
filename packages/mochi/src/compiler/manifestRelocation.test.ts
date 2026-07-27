// A manifest holds no absolute paths at all: artifacts are out-dir-relative and
// sources are project-root-relative. So a prebuilt app survives "build here,
// deploy there", and a manifest carries nothing specific to the machine that
// produced it. Prove it end-to-end: build into one directory, move it, and
// boot from the new location — pages SSR, the emitted image asset serves from
// the relocated directory, and the local-asset registry repopulates with
// relocated paths. Static files are the deliberate exception: the build copies
// nothing, so they keep serving from the unmoved `publicDir`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { getLocalImageAsset } from '../image/localAssetRegistry';
import { FRAMEWORK_PREFIX } from './manifestPaths';
import { toPosixPath } from '../utils';
import type { MochiManifest } from '../types';

const GLOBAL_LOCAL_ASSETS_KEY = '__mochi_local_image_assets__';

// Windows can hold a just-built tree briefly after the handles into it are dropped.
const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

// Every source-path family has to be populated or the sweep below passes
// vacuously: an image import, a side-effect CSS import, a hydratable island and
// a server island, each of the last two carrying scoped CSS of its own.
const PAGE_SRC = `<script>
  import hero from './hero.png';
  import './fonts.css';
  import Widget from './Widget.svelte';
  import Panel from './Panel.svelte';
</script>
<img src={hero.src} width={hero.width} height={hero.height} alt="" />
<Widget mochi:hydrate />
<Panel mochi:defer />
`;

const WIDGET_SRC = `<p class="widget">widget</p>
<style>
  .widget { color: rebeccapurple; }
</style>
`;

const PANEL_SRC = `<p class="panel">panel</p>
<style>
  .panel { color: teal; }
</style>
`;

const FONTS_CSS = `:root { --reloc: 1; }\n`;

const ROBOTS_TXT = 'User-agent: *\nDisallow:\n';

const PACKAGE_ROOT = path.resolve(import.meta.dir, '..', '..');

/** Every path in the manifest that names a *source* file rather than an artifact. */
function sourcePaths(m: MochiManifest): string[] {
  return [
    ...Object.keys(m.components),
    ...Object.values(m.components).flatMap((c) => [...c.cssComponents, ...c.hydratables.map((h) => h.resolvedPath)]),
    ...Object.keys(m.cssFileUrls),
    ...Object.values(m.serverIslandPaths ?? {}),
    ...Object.keys(m.importedCssUrls ?? {}),
    ...Object.entries(m.entryImportedCss ?? {}).flatMap(([entry, css]) => [entry, ...css]),
  ];
}

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
    writeFileSync(path.join(fixtureDir, 'Widget.svelte'), WIDGET_SRC);
    writeFileSync(path.join(fixtureDir, 'Panel.svelte'), PANEL_SRC);
    writeFileSync(path.join(fixtureDir, 'fonts.css'), FONTS_CSS);
    // Static files are the one category whose source lives outside outDir, and
    // therefore the one most able to leak an absolute path. `build()` copies
    // none of them, so the proof here is the inverse of the other families: the
    // manifest must not name this file at all, and it must still serve.
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
      // The fixture dir was never moved: production scans `publicDir` like dev
      // does, so this — not the relocated build — is what answers /robots.txt.
      publicDir,
    });
  });

  afterAll(() => {
    server?.stop(true);
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_LOCAL_ASSETS_KEY];
    rmSync(fixtureDir, RM_OPTS);
    rmSync(outDir, RM_OPTS);
    rmSync(buildDir, RM_OPTS);
  });

  test('manifest is v2 and contains no absolute artifact paths', () => {
    expect(manifest.version).toBe(2);
    // Guard the categories that would otherwise pass this test vacuously — an
    // empty map has no absolute paths in it either.
    expect(Object.keys(manifest.components).length).toBeGreaterThan(0);
    expect(Object.keys(manifest.clientFiles).length).toBeGreaterThan(0);
    // Static files are not an artifact family — the key must be gone, not empty.
    expect(Object.keys(manifest)).not.toContain('publicFiles');
    expect(Object.keys(manifest.localImageAssets ?? {}).length).toBeGreaterThan(0);
    expect(manifest.serverIslandScript).toBeString();

    const diskPaths = [
      ...Object.values(manifest.components).map((c) => c.ssrModule),
      ...Object.values(manifest.clientFiles),
      ...Object.values(manifest.localImageAssets ?? {}).map((a) => a.diskPath),
      manifest.serverIslandScript!,
    ];
    for (const p of diskPaths) {
      expect(path.isAbsolute(p), `expected outDir-relative path, got "${p}"`).toBe(false);
      expect(p, `expected a POSIX path, got "${p}"`).not.toContain('\\');
    }
  });

  test('every source path is project-root-relative or framework-owned', () => {
    // Same vacuity guard as above, one per family this sweep covers.
    expect(Object.keys(manifest.cssFileUrls).length).toBeGreaterThan(0);
    expect(Object.keys(manifest.serverIslandPaths ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(manifest.importedCssUrls ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(manifest.entryImportedCss ?? {}).length).toBeGreaterThan(0);
    expect(Object.values(manifest.components).some((c) => c.cssComponents.length > 0 && c.hydratables.length > 0)).toBe(true);

    for (const p of sourcePaths(manifest)) {
      if (p.startsWith(FRAMEWORK_PREFIX)) {
        continue;
      }
      expect(path.isAbsolute(p), `expected a project-root-relative path, got "${p}"`).toBe(false);
      expect(p, `expected a POSIX path, got "${p}"`).not.toContain('\\');
    }
  });

  test('the serialized manifest names no directory outside the build', async () => {
    // The end the other two tests exist for: nothing in a shipped manifest can
    // identify the machine that built it. This fixture builds entirely inside
    // the package, so a single prefix covers the sources, the out-dir, and the
    // framework's own files.
    const raw = await Bun.file(path.join(outDir, 'manifest.json')).text();
    expect(raw).not.toContain(PACKAGE_ROOT);
    expect(raw).not.toContain(toPosixPath(PACKAGE_ROOT));
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

  test('a public file serves from the source publicDir, and the build copied nothing', async () => {
    expect(existsSync(path.join(outDir, 'public'))).toBe(false);
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

// A relative outDir resolves against the cwd of whoever asks, and compile and
// toManifest() ask at different moments. Pinning it at construction is what
// keeps a chdir in between from making every artifact look like it escaped.
describe('outDir is resolved once, at construction', () => {
  test('a chdir between setup and toManifest() does not escape the out-dir', async () => {
    const { ComponentRegistry } = await import('./ComponentRegistry');
    const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-reloc-cwd-'));
    const cwd = process.cwd();
    try {
      mkdirSync(path.join(root, 'sub'), { recursive: true });
      process.chdir(root);
      const registry = new ComponentRegistry({ development: false, outDir: './.mochi', assetPrefix: '/_mochi' });
      registry.setServerIslandScript(path.resolve('./.mochi/server-island.js'), '');

      process.chdir(path.join(root, 'sub'));
      expect(registry.toManifest().serverIslandScript).toBe('server-island.js');
    } finally {
      process.chdir(cwd);
      rmSync(root, RM_OPTS);
    }
  });
});
