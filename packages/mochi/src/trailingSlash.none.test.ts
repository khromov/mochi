// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('trailingSlash: unset (no policy)', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-trailing-slash-none-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/about': Mochi.page(FIXTURE_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('canonical form serves 200', async () => {
    const res = await fetch(`${base}/about`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  test('alternate slash form is NOT registered (404)', async () => {
    const res = await fetch(`${base}/about/`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  test('internal /_mochi/client/stats/ is gated out of production (404)', async () => {
    // The client-stats route is registered only when the debug bar is enabled
    // (development), so on a production server it 404s regardless of slash form —
    // it would otherwise disclose bundle input paths and sizes.
    const res = await fetch(`${base}/_mochi/client/stats/`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});
