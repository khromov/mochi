import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

// /discord and /support are Mochi.api() routes, so the site's trailingSlash: 'always'
// never mirrors them onto the alt-slash form. Links to both forms are already published,
// so routes.ts registers each by hand — boot the real route values to prove both resolve.
const TARGETS: Record<string, string> = {
  '/discord': 'https://discord.com/invite/QCGfks4gg8',
  '/support': 'https://support.mochi.fast/',
};

const VANITY_PATTERNS = Object.keys(TARGETS).flatMap((p) => [p, `${p}/`]);

describe('vanity redirects', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-vanity-redirects-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      // Mirrors src/index.ts, so the api exemption is exercised under the real policy.
      trailingSlash: 'always',
      routes: Object.fromEntries(VANITY_PATTERNS.map((pattern) => [pattern, routes[pattern]!])),
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('routes.ts registers both slash forms of every vanity redirect', () => {
    expect(VANITY_PATTERNS.filter((pattern) => !(pattern in routes))).toEqual([]);
  });

  for (const [pattern, target] of Object.entries(TARGETS)) {
    for (const form of [pattern, `${pattern}/`]) {
      test(`${form} redirects to ${target} without a trailing-slash hop`, async () => {
        const res = await fetch(`${base}${form}`, { redirect: 'manual' });
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe(target);
      });
    }
  }
});
