// Eager discovery (see build.ts) is expected to always populate the manifest, so a
// server island that's in `serverIslandPaths` but missing its `components` entry
// should never happen for real — this simulates that gap by tampering with a built
// manifest, then asserts the runtime falls back to an on-demand compile (rather than
// 404ing or crashing) and warns loudly, since a live occurrence would indicate a bug
// in Mochi's own discovery rather than something a user did wrong.
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { stringify as devalueStringify } from 'devalue';
import { runIsolatedBuild } from './utils/runIsolatedBuild';
import { Mochi } from './Mochi';
import { logger } from './log';
import { encryptProps } from './serverIslandCrypto';
import type { MochiManifest } from './types';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'server-island-endpoint', 'Page.svelte');

describe('server-island manifest miss', () => {
  const dirs: string[] = [];
  const freshOutDir = () => {
    const dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-island-miss-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  test('warns and falls back to an on-demand compile instead of 404ing or crashing', async () => {
    const outDir = freshOutDir();
    await runIsolatedBuild(FIXTURE_PAGE, outDir);

    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest: MochiManifest = JSON.parse(await Bun.file(manifestPath).text());
    // Islands are keyed by `<localName>_<hash>` (see islandIdentity), not the bare
    // import name; recover the concrete `Echo_…` key from the manifest.
    const echoKey = Object.keys(manifest.serverIslandPaths ?? {}).find((k) => k.startsWith('Echo_'));
    expect(echoKey, 'expected Echo in serverIslandPaths').toBeDefined();
    const echoPath = manifest.serverIslandPaths![echoKey!];
    // Simulate the gap: discovery found Echo, but it never made it into
    // `components` (e.g. a future bug in the precompile pass).
    delete manifest.components[echoPath!];
    await Bun.write(manifestPath, JSON.stringify(manifest));

    const warnSpy = spyOn(logger, 'warn');
    let server: Server<undefined> | undefined;
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
      const props = encryptProps(devalueStringify({ name: 'World' }), echoKey!);
      const res = await fetch(`${base}/_mochi/island/${echoKey}?props=${encodeURIComponent(props)}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('>World<');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`Server island "${echoKey}" was missing from the prebuilt manifest`));
    } finally {
      warnSpy.mockRestore();
      server?.stop(true);
    }
  });
});
