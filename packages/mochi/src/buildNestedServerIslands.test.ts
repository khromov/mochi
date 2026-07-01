// The build precompiles server islands (mochi:defer) in a single pass over
// whatever `getServerIslandPaths()` holds after the page compile. Discovery is
// eager — the page compile transitively preprocesses every nested `mochi:defer`
// component, because its import survives into the compiled source even though
// only the markup usage is rewritten — so a deeply nested chain still resolves
// in that one pass. This covers that the whole chain lands in the manifest.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runIsolatedBuild } from './buildFixture.isolated';
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

  test('compiles every nesting level into the manifest in one pass', async () => {
    const outDir = freshOutDir();
    await runIsolatedBuild(FIXTURE_PAGE, outDir);

    const manifest: MochiManifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
    expect(Object.keys(manifest.serverIslandPaths ?? {}).sort()).toEqual(['Level1', 'Level2', 'Level3']);
    for (const islandPath of Object.values(manifest.serverIslandPaths ?? {})) {
      expect(manifest.components[islandPath], `expected components entry for ${islandPath}`).toBeDefined();
    }
  });
});
