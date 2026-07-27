// In dev mode every page is registered as a method-keyed Bun route object
// (because pageConfigMap is populated for live reload), so this guards that a
// plain page still answers HEAD with 200 rather than Bun's 405 for an unlisted
// method. The public-file HEAD case rides along here rather than in its own
// file because only one Mochi.serve() is allowed per process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');
const ROBOTS_BODY = 'User-agent: *\nDisallow:\n';

describe('HEAD requests (development)', () => {
  let server: Server<undefined>;
  let outDir: string;
  let publicDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-head-dev-'));
    publicDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-head-dev-public-'));
    writeFileSync(path.join(publicDir, 'robots.txt'), ROBOTS_BODY);
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      publicDir,
      routes: { '/': Mochi.page(FIXTURE_PAGE) },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
  });

  test('plain page in dev mode answers HEAD with 200, not 405', async () => {
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  test('public file: HEAD mirrors GET status/headers with an empty body and matching Content-Length', async () => {
    const get = await fetch(`${base}/robots.txt`);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(ROBOTS_BODY);

    const head = await fetch(`${base}/robots.txt`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe(get.headers.get('Content-Type'));
    expect(head.headers.get('Content-Length')).toBe(String(Buffer.byteLength(ROBOTS_BODY, 'utf8')));
    expect(await head.text()).toBe('');
  });
});
