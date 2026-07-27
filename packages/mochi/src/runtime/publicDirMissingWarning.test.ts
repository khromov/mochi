// The build copies no static files, so on disk a deploy that shipped `public/` and one that forgot it are
// indistinguishable — the shape a Docker final stage hits copying `.mochi/` and `src/` selectively — leaving the
// manifest's build-time count the only witness. This exercises the boot check that reads it, in its own file because
// one `Mochi.serve()` is allowed per process (publicDirProduction.test.ts covers the healthy-boot side).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { logger } from '../utils/log';
import type { MochiManifest } from '../types';

const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const tempDir = (prefix: string) => mkdtempSync(path.join(import.meta.dir, '..', '..', prefix));

describe('a deploy that left publicDir behind warns at boot', () => {
  const routes = { '/ping': Mochi.api(() => new Response('pong')) };
  let publicDir: string;
  let outDir: string;
  let manifest: MochiManifest;
  let server: Server<undefined> | undefined;
  let warnings: string[];

  beforeAll(async () => {
    publicDir = tempDir('.mochi-public-missing-src-');
    outDir = tempDir('.mochi-public-missing-out-');
    writeFileSync(path.join(publicDir, 'robots.txt'), 'User-agent: *\nDisallow:\n');
    writeFileSync(path.join(publicDir, 'favicon.ico'), 'x');

    await build({ routes, development: false, outDir, publicDir });
    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());

    // The deploy the check exists for: the build output travels, the static files don't. Removing the directory
    // outright is the truer reproduction, since a Dockerfile that never COPYs it leaves nothing rather than an empty dir.
    rmSync(publicDir, RM_OPTS);

    warnings = [];
    const originalWarn = logger.warn;
    logger.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      server = await Mochi.serve({ port: 0, development: false, warmup: false, logger: { enabled: false }, outDir, publicDir, routes });
    } finally {
      logger.warn = originalWarn;
    }
  });

  afterAll(() => {
    server?.stop(true);
    rmSync(publicDir, RM_OPTS);
    rmSync(outDir, RM_OPTS);
  });

  test('the build records how many static files it saw', () => {
    expect(manifest.publicFileCount).toBe(2);
  });

  test('boot warns once, with the count and something to do about it', () => {
    const hits = warnings.filter((w) => w.includes('every static file will 404'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('2 file(s)');
    expect(hits[0]).toContain('COPY');
  });

  test('it warns rather than refusing to boot', async () => {
    const res = await fetch(`http://localhost:${server!.port}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pong');
  });
});
