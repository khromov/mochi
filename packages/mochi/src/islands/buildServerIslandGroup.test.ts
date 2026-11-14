// Grouping rewrites how an island is *addressed*, not how it is discovered, so `build()` must still precompile every
// member. Asserts the manifest carries them all, and that serving from it answers a group fetch with no runtime compile.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { mochiEvents } from '../events';
import type { MochiManifest } from '../types';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'island-groups', 'Page.svelte');

describe('build precompiles grouped server islands', () => {
  let outDir: string;
  let manifest: MochiManifest;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-group-build-'));
    await build({ routes: { '/': Mochi.page(FIXTURE_PAGE) }, development: false, outDir });
    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('every grouped member is discovered, not just the ungrouped island', () => {
    expect(Object.keys(manifest.serverIslandPaths ?? {}).sort()).toEqual([
      expect.stringMatching(/^Boom_\w+$/),
      expect.stringMatching(/^Counter_\w+$/),
      expect.stringMatching(/^Feed_\w+$/),
      expect.stringMatching(/^Stars_\w+$/),
    ]);
  });

  test('each member has a standalone SSR module on disk', async () => {
    const islandPaths = Object.values(manifest.serverIslandPaths ?? {});
    expect(islandPaths).toHaveLength(4);
    for (const islandPath of islandPaths) {
      const entry = manifest.components[islandPath];
      expect(entry, `expected manifest.components["${islandPath}"]`).toBeDefined();
      expect(await Bun.file(path.resolve(outDir, entry!.ssrModule)).exists()).toBe(true);
    }
  });

  test('a group fetch off the prebuilt manifest compiles nothing at runtime', async () => {
    let server: Server<undefined> | undefined;
    const compiled: string[] = [];
    const onCompile = ({ path: p }: { path: string }) => compiled.push(p);
    mochiEvents.on('compile:complete', onCompile);
    try {
      server = await Mochi.serve({
        port: 0,
        development: false,
        warmup: false,
        logger: { enabled: false },
        outDir,
        routes: { '/': Mochi.page(FIXTURE_PAGE) },
      });
      const base = `http://localhost:${server.port}`;
      const html = await (await fetch(`${base}/`)).text();
      const chunk = html.match(/<mochi-island-group\b[^>]*\bchunks="([^" ]+)/)?.[1];
      expect(chunk).toBeTruthy();

      compiled.length = 0;
      const res = await fetch(`${base}/_mochi/island-group/sidebar?g=${chunk}`);
      expect(res.status).toBe(200);
      const { m } = (await res.json()) as { m: Record<string, string> };
      expect(Object.keys(m)).toHaveLength(6);
      expect(Object.values(m).join('')).toContain('alpha:5');
      expect(compiled).toEqual([]);
    } finally {
      mochiEvents.off('compile:complete', onCompile);
      await server?.stop(true);
    }
  });
});
