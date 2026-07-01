// The build precompiles server islands in waves (pages → newly-discovered islands
// → islands discovered by compiling those). Discovery is eager — the page compile
// transitively preprocesses every nested `mochi:defer` component — so a deeply
// nested chain still resolves in a single wave; this covers that the whole chain
// lands in the manifest, and that the `maxIslandDepth` tripwire throws rather than
// looping unbounded (exercised at the boundary by capping waves at 0).
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from './build';
import { Mochi } from './Mochi';
import type { MochiManifest } from './types';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'nested-server-islands', 'Page.svelte');

describe('build precompiles nested server islands', () => {
  const dirs: string[] = [];
  const freshOutDir = () => {
    const dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-nested-islands-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  test('compiles every nesting level into the manifest under the default depth', async () => {
    const outDir = freshOutDir();
    await build({ routes: { '/': Mochi.page(FIXTURE_PAGE) }, development: false, outDir });

    const manifest: MochiManifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
    expect(Object.keys(manifest.serverIslandPaths ?? {}).sort()).toEqual(['Level1', 'Level2', 'Level3']);
    for (const islandPath of Object.values(manifest.serverIslandPaths ?? {})) {
      expect(manifest.components[islandPath], `expected components entry for ${islandPath}`).toBeDefined();
    }
  });

  test('throws when island waves exceed maxIslandDepth instead of looping unbounded', async () => {
    const outDir = freshOutDir();
    // Discovery is eager, so a normal build needs exactly one wave; capping at 0
    // makes any server island trip the tripwire, exercising the guard's boundary.
    expect(build({ routes: { '/': Mochi.page(FIXTURE_PAGE) }, development: false, outDir, maxIslandDepth: 0 })).rejects.toThrow(/exceeded maxIslandDepth \(0\)/);
  });
});
