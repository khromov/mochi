// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const PAGE = path.join(import.meta.dir, '__fixtures__', 'asset-cache', 'Page.svelte');

describe('Cache-Control on prebuilt framework assets (dev mode)', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let pageHtml: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-asset-cache-dev-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      routes: {
        '/page': Mochi.page(PAGE),
      },
    });
    base = `http://localhost:${server.port}`;
    const res = await fetch(`${base}/page`);
    pageHtml = await res.text();
    expect(res.status).toBe(200);
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('CSS bundle is served without Cache-Control so live-reload edits are not pinned', async () => {
    const match = pageHtml.match(/\/_mochi\/[^"'\s]+\.css/);
    if (!match) {
      throw new Error(`No CSS asset URL found in page HTML:\n${pageHtml}`);
    }
    const res = await fetch(`${base}${match[0]}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/css');
    expect(res.headers.get('cache-control')).toBeNull();
  });
});
