// The build validates `publicDir` but never copies it: the runtime scans the
// directory at startup in production exactly as it does in development. These
// are the assertions no build-time-snapshot design could satisfy — a file added
// after the build still serves, and `<outDir>/public` never exists.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { logger } from '../utils/log';
import type { MochiManifest } from '../types';

const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const ROBOTS_TXT = 'User-agent: *\nDisallow:\n';
const LATE_TXT = 'ADDED_AFTER_THE_BUILD';

const tempDir = (prefix: string) => mkdtempSync(path.join(import.meta.dir, '..', '..', prefix));

describe('production serves static files from publicDir', () => {
  let publicDir: string;
  let outDir: string;
  let manifest: MochiManifest;
  let server: Server<undefined> | undefined;
  let warnings: string[];

  beforeAll(async () => {
    publicDir = tempDir('.mochi-public-prod-src-');
    outDir = tempDir('.mochi-public-prod-out-');
    writeFileSync(path.join(publicDir, 'robots.txt'), ROBOTS_TXT);

    // `/shadowed.txt` is a route at build time with no file behind it, so the
    // build's collision check passes; the file appears below.
    const routes = { '/shadowed.txt': Mochi.api(() => new Response('FROM_THE_ROUTE')) };
    await build({ routes, development: false, outDir, publicDir });
    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());

    // Both written after the build, which is the whole point: production reads
    // the directory, not a list frozen when the manifest was written.
    writeFileSync(path.join(publicDir, 'late.txt'), LATE_TXT);
    writeFileSync(path.join(publicDir, 'shadowed.txt'), 'FROM_THE_FILE');

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

  test('the build copies nothing and names no static file in the manifest', () => {
    expect(existsSync(path.join(outDir, 'public'))).toBe(false);
    expect(Object.keys(manifest)).not.toContain('publicFiles');
    // A count, not a list — enough for the missing-publicDir check at boot.
    expect(manifest.publicFileCount).toBe(1);
  });

  test('a publicDir that did ship draws no warning', () => {
    // The other half of publicDirMissingWarning.test.ts: the check must stay silent on a healthy boot, or it trains people to ignore it.
    expect(warnings.filter((w) => w.includes('every static file will 404'))).toEqual([]);
  });

  test('a file present at build time serves', async () => {
    const res = await fetch(`http://localhost:${server!.port}/robots.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ROBOTS_TXT);
  });

  test('a file added after the build serves', async () => {
    const res = await fetch(`http://localhost:${server!.port}/late.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(LATE_TXT);
  });

  test('a route still wins over a static file that appeared after the build', async () => {
    const res = await fetch(`http://localhost:${server!.port}/shadowed.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('FROM_THE_ROUTE');
  });
});

// The scan is now the only reason `build()` reads publicDir, so leaving this
// untested invites a future cleanup to delete it silently. Unlike the runtime's
// warn-and-skip, the build refuses to produce output at all — it is the one
// moment the whole route table and the whole directory are both known.
describe('the build rejects a static file that shadows a route', () => {
  let publicDir: string;
  const outDirs: string[] = [];

  beforeAll(() => {
    publicDir = tempDir('.mochi-public-collide-src-');
    writeFileSync(path.join(publicDir, 'robots.txt'), ROBOTS_TXT);
    writeFileSync(path.join(publicDir, 'a b.txt'), 'SPACED');
  });

  afterAll(() => {
    rmSync(publicDir, RM_OPTS);
    for (const dir of outDirs) {
      rmSync(dir, RM_OPTS);
    }
  });

  // The runtime registers public files under their percent-encoded key, so a
  // route declared in encoded form collides there but slips past a raw compare.
  test.each([
    ['a raw route key', '/robots.txt', '/robots.txt'],
    ['a percent-encoded route key', '/a%20b.txt', '/a b.txt'],
  ])('%s is reported', async (_label, routePattern, expectedInMessage) => {
    const outDir = tempDir('.mochi-public-collide-out-');
    outDirs.push(outDir);
    const promise = build({ routes: { [routePattern]: Mochi.api(() => new Response('x')) }, development: false, outDir, publicDir });
    await expect(promise).rejects.toThrow('collide with registered routes');
    await expect(promise).rejects.toThrow(expectedInMessage);
  });
});
