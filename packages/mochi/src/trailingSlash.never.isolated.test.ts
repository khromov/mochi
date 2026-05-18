import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('trailingSlash: "never"', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-trailing-slash-never-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      trailingSlash: 'never',
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
        '/about': Mochi.page(FIXTURE_PAGE),
        '/docs/:slug': Mochi.page(FIXTURE_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('GET trailing-slash form 301s to canonical (no slash)', async () => {
    const res = await fetch(`${base}/about/`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/about');
  });

  test('GET canonical form (no slash) serves 200', async () => {
    const res = await fetch(`${base}/about`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  test('parameterised route: GET /docs/intro/ → 301 → /docs/intro', async () => {
    const res = await fetch(`${base}/docs/intro/`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/docs/intro');
  });

  test('parameterised route: GET /docs/intro → 200', async () => {
    const res = await fetch(`${base}/docs/intro`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  test('root path is never redirected', async () => {
    const res = await fetch(`${base}/`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });
});
