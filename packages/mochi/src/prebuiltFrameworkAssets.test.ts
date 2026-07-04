// `build()` bakes framework assets into the manifest so the production runtime
// skips them at startup:
//   - B1: the minified ServerIsland inline web-component script is prebuilt to
//     disk and referenced by `manifest.serverIslandScript`; the runtime loads it
//     instead of running Bun.build at boot.
//   - B2: the framework error page + client-stats page are compiled into
//     `manifest.components`, so the boot-time compileAll is a no-op (no SSR
//     compile of any component on startup).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { runIsolatedBuild } from './utils/runIsolatedBuild';
import { Mochi } from './Mochi';
import { mochiEvents } from './events';
import { DEFAULT_ERROR_PAGE_PATH } from './errors';
import { CLIENT_STATS_COMPONENT } from './clientStatsRoutes';
import { buildInlineWebComponent } from './buildInlineWebComponent';
import type { MochiManifest } from './types';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'server-island-endpoint', 'Page.svelte');

describe('build bakes framework assets into the manifest', () => {
  let outDir: string;
  let manifest: MochiManifest;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-framework-assets-'));
    await runIsolatedBuild(FIXTURE_PAGE, outDir);
    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('B1: manifest references a prebuilt ServerIsland script that exists and matches the live build', async () => {
    expect(manifest.serverIslandScript).toBeString();
    const diskPath = path.resolve(manifest.serverIslandScript!);
    expect(await Bun.file(diskPath).exists()).toBe(true);
    const baked = await Bun.file(diskPath).text();
    expect(baked.length).toBeGreaterThan(0);
    expect(baked).toBe(await buildInlineWebComponent('./web-components/ServerIsland.ts'));
  });

  test('B2: the framework error page + client-stats page are in manifest.components', () => {
    expect(manifest.components[DEFAULT_ERROR_PAGE_PATH]).toBeDefined();
    expect(manifest.components[CLIENT_STATS_COMPONENT]).toBeDefined();
  });

  test('booting from the manifest compiles nothing and inlines the prebuilt server-island script', async () => {
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
      const res = await fetch(`http://localhost:${server.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      // B1 end-to-end: the page has server islands, so the inline runtime is emitted.
      expect(html).toContain('<script>(()=>{');
      // B2: no component compiled on startup — everything came from the manifest.
      expect(compiled).toEqual([]);
    } finally {
      mochiEvents.off('compile:complete', onCompile);
      server?.stop(true);
    }
  });
});
