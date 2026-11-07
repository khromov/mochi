// Source paths are keyed relative to the project root, so a build made under one
// project root has to boot under a different one — the case a Docker deploy hits
// whenever the build stage and the release stage don't share a path. The v2
// relocation test moves the *out-dir*; this one moves the whole project.
//
// process.chdir() is safe here because every test file runs in its own process
// (scripts/run-tests.ts), and this is the only describe in the file.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { logger } from '../utils/log';
import type { MochiManifest } from '../types';

const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const PAGE_SRC = `<script>
  import Widget from './Widget.svelte';
</script>
<h1>relocated</h1>
<Widget mochi:hydrate />
`;

const WIDGET_SRC = `<p class="widget">widget</p>
<style>
  .widget { color: rebeccapurple; }
</style>
`;

describe('a build made under one project root boots under another', () => {
  const originalCwd = process.cwd();
  let rootA: string;
  let rootB: string;
  let manifest: MochiManifest;
  let server: Server<undefined> | undefined;
  let warnings: string[];

  beforeAll(async () => {
    // Both roots live inside the package: the compiled SSR modules resolve
    // node_modules from the out-dir, so a temp dir outside the project tree has
    // no module chain back to the framework.
    rootA = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-project-root-a-'));
    mkdirSync(path.join(rootA, 'app'), { recursive: true });
    writeFileSync(path.join(rootA, 'app', 'Page.svelte'), PAGE_SRC);
    writeFileSync(path.join(rootA, 'app', 'Widget.svelte'), WIDGET_SRC);

    process.chdir(rootA);
    // Registered relative, as an app would.
    await build({ routes: { '/': Mochi.page('app/Page.svelte') }, development: false, outDir: 'out' });
    manifest = JSON.parse(await Bun.file(path.join(rootA, 'out', 'manifest.json')).text());

    rootB = `${rootA.replace('.mochi-project-root-a-', '.mochi-project-root-b-')}`;
    cpSync(rootA, rootB, { recursive: true });

    process.chdir(rootB);
    warnings = [];
    const originalWarn = logger.warn;
    logger.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      server = await Mochi.serve({
        port: 0,
        development: false,
        warmup: false,
        logger: { enabled: false },
        outDir: path.join(rootB, 'out'),
        // Registered *absolutely*, and under the new root — neither spelling nor
        // location matches the build, and both still have to resolve.
        routes: { '/': Mochi.page(path.join(rootB, 'app', 'Page.svelte')) },
      });
    } finally {
      logger.warn = originalWarn;
    }
  });

  afterAll(() => {
    server?.stop(true);
    process.chdir(originalCwd);
    rmSync(rootA, RM_OPTS);
    rmSync(rootB, RM_OPTS);
  });

  test('the page key is relative to the project root, not the build machine', () => {
    expect(Object.keys(manifest.components)).toContain('app/Page.svelte');
  });

  test('the page SSRs under the new root', async () => {
    const res = await fetch(`http://localhost:${server!.port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('relocated');
    // The island's scoped CSS resolves through the restored maps.
    expect(html).toMatch(/<link[^>]+\/_mochi\/css\/Widget-[^"]+\.css/);
  });

  test('nothing was recompiled to serve it', () => {
    // The positive proof that the manifest was hit rather than silently
    // rebuilt: a miss logs, loudly, from compileAll().
    expect(warnings.filter((w) => w.includes('missing from the prebuilt manifest'))).toEqual([]);
  });

  test('it serves with the sources deleted', async () => {
    // Nothing short of this rules out a compile-from-source fallback.
    rmSync(path.join(rootB, 'app'), RM_OPTS);
    const res = await fetch(`http://localhost:${server!.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('relocated');
  });
});
