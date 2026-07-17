// `build()` precompiles every server island (mochi:defer) as a standalone SSR
// module so the production runtime never compiles on a request path. Asserts the
// island lands in `manifest.components` (not only `serverIslandPaths`), and that
// booting from that manifest and fetching the island fires no on-demand compile.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { stringify as devalueStringify } from 'devalue';
import { runIsolatedBuild } from '../utils/runIsolatedBuild';
import { Mochi } from '../Mochi';
import { mochiEvents } from '../events';
import { encryptProps } from './serverIslandCrypto';
import type { MochiManifest } from '../types';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'server-island-endpoint', 'Page.svelte');

describe('build precompiles server islands into the manifest', () => {
  let outDir: string;
  let manifest: MochiManifest;
  let islandPaths: string[];
  // Islands are keyed by `<localName>_<hash>` (see islandIdentity), not the bare
  // import name; recover the concrete `Echo_…` key from the manifest.
  let echoKey: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-manifest-'));
    await runIsolatedBuild(FIXTURE_PAGE, outDir);
    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
    islandPaths = Object.values(manifest.serverIslandPaths ?? {});
    echoKey = Object.keys(manifest.serverIslandPaths ?? {}).find((k) => k.startsWith('Echo_'))!;
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the fixture declares the expected server islands', () => {
    expect(Object.keys(manifest.serverIslandPaths ?? {}).sort()).toEqual([expect.stringMatching(/^Echo_\w+$/), expect.stringMatching(/^StyledLeaf_\w+$/)]);
  });

  test('each server-island source path has a standalone components entry whose ssrModule exists', async () => {
    for (const islandPath of islandPaths) {
      const entry = manifest.components[islandPath];
      expect(entry, `expected manifest.components["${islandPath}"]`).toBeDefined();
      expect(await Bun.file(entry!.ssrModule).exists()).toBe(true);
    }
  });

  test('booting from the manifest and fetching an island does not compile at runtime', async () => {
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
      const props = encryptProps(devalueStringify({ name: 'World' }), echoKey);
      const res = await fetch(`${base}/_mochi/island/${echoKey}?props=${encodeURIComponent(props)}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('>World<');
      // Boot may compile framework-internal templates (error page, debug bar);
      // what matters is that no user server island compiled on the request path.
      expect(compiled.filter((p) => islandPaths.includes(p))).toEqual([]);
    } finally {
      mochiEvents.off('compile:complete', onCompile);
      server?.stop(true);
    }
  });
});
