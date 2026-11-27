// Bun's resolver canonicalises symlinks and caches what it finds under the real path, so a build that wrote and
// imported its intermediate SSR modules through a symlinked out-dir spelling stopped seeing the ones a later compile
// pass added — `mochi-framework build --out-dir /var/…` on macOS failed on the first server island.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from './build';
import { ComponentRegistry } from '../compiler/ComponentRegistry';
import { Mochi } from '../Mochi';
import type { MochiManifest } from '../types';

const PKG_ROOT = path.join(import.meta.dir, '..', '..');

// Sources live outside the framework package, as an app's do — the island pass only misses the artifact it just wrote
// when the page cohort and the island resolve from different roots.
const srcDir = mkdtempSync(path.join(PKG_ROOT, '.mochi-symlink-src-'));
writeFileSync(path.join(srcDir, 'Island.svelte'), '<p>island</p>\n');
writeFileSync(path.join(srcDir, 'Page.svelte'), '<script lang="ts">\n  import Island from \'./Island.svelte\';\n</script>\n\n<h1>page</h1>\n<Island mochi:defer />\n');

const realDir = mkdtempSync(path.join(PKG_ROOT, '.mochi-symlink-out-'));
const linkDir = `${realDir}-link`;
// Unprivileged Windows refuses directory symlinks; a junction is the equivalent it always allows.
let linked = false;
try {
  symlinkSync(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
  linked = true;
} catch {
  rmSync(realDir, { recursive: true, force: true });
  rmSync(srcDir, { recursive: true, force: true });
}

describe.if(linked)('an out-dir reached through a symlink', () => {
  const outDir = path.join(linkDir, 'out');

  afterAll(() => {
    unlinkSync(linkDir);
    rmSync(realDir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  test('the registry pins the real path, so every writer and importer agrees on one spelling', () => {
    expect(new ComponentRegistry({ outDir }).outDir).toBe(path.join(realpathSync(linkDir), 'out'));
  });

  describe('building into it', () => {
    let manifest: MochiManifest;

    beforeAll(async () => {
      await build({ routes: { '/': Mochi.page(path.join(srcDir, 'Page.svelte')) }, development: false, outDir });
      manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
    });

    test('precompiles the server island', async () => {
      const islandPaths = Object.values(manifest.serverIslandPaths ?? {});
      expect(islandPaths.length).toBe(1);
      const entry = manifest.components[islandPaths[0]!];
      expect(entry, `expected manifest.components["${islandPaths[0]}"]`).toBeDefined();
      expect(await Bun.file(path.resolve(realDir, 'out', entry!.ssrModule)).exists()).toBe(true);
    });
  });
});
