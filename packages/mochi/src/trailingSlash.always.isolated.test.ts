import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { json } from './utils';

// Each Mochi.serve() pins instance state on globalThis, so only one server
// can run per process. Each `trailingSlash` policy lives in its own
// `*.isolated.test.ts` file (always / never / none).

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('trailingSlash: "always"', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-trailing-slash-always-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      trailingSlash: 'always',
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
        '/about': Mochi.page(FIXTURE_PAGE),
        '/docs/:slug': Mochi.page(FIXTURE_PAGE),
        '/api/ping': Mochi.api(async () => json({ ok: true })),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('GET non-canonical form 301s to canonical (with slash)', async () => {
    const res = await fetch(`${base}/about`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/about/');
  });

  test('GET canonical form (with slash) serves 200', async () => {
    const res = await fetch(`${base}/about/`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  test('parameterised route: GET /docs/intro → 301 → /docs/intro/', async () => {
    const res = await fetch(`${base}/docs/intro`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/docs/intro/');
  });

  test('parameterised route: GET /docs/intro/ → 200 (the original bug)', async () => {
    const res = await fetch(`${base}/docs/intro/`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  test('preserves query string when redirecting', async () => {
    const res = await fetch(`${base}/about?q=mochi`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/about/?q=mochi');
  });

  test('POST uses 308 (preserves method/body)', async () => {
    const res = await fetch(`${base}/about`, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: base },
    });
    expect(res.status).toBe(308);
  });

  test('root path is never redirected', async () => {
    const res = await fetch(`${base}/`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  test('api route also redirects non-canonical form', async () => {
    const res = await fetch(`${base}/api/ping`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/api/ping/');
  });

  test('api route serves canonical form', async () => {
    const res = await fetch(`${base}/api/ping/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
