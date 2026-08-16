// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { json } from '../utils';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'css-imports', 'Page.svelte');

describe('trailingSlash: "always"', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const filteredPaths: string[] = [];

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-trailing-slash-always-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      trailingSlash: 'always',
      filters: {
        'trailingSlash:redirect': (redirect, { url }) => {
          filteredPaths.push(url.pathname);
          return redirect;
        },
      },
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
        '/about': Mochi.page(FIXTURE_PAGE),
        '/docs/:slug': Mochi.page(FIXTURE_PAGE),
        '/api/ping': Mochi.api(async () => json({ ok: true })),
        // Declared *with* the slash: the alt form is the slashless one, which is what
        // reaches the fall-through exemption check under this policy.
        '/api/slashed/': Mochi.api(async () => json({ ok: true })),
        '/sse/ticks': Mochi.sse((stream) => {
          stream.send('tick');
          stream.close();
        }),
        '/ws/echo': Mochi.ws({ message() {} }),
        '/files/report': Mochi.file(FIXTURE_PAGE),
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

  test('api route is exempt: declared pattern serves 200 with no redirect', async () => {
    const res = await fetch(`${base}/api/ping`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('api route is exempt: alt-slash form is not mirrored (404, no redirect)', async () => {
    const res = await fetch(`${base}/api/ping/`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  test('a slash-declared api route serves its pattern and 404s the slashless form instead of redirecting', async () => {
    expect((await fetch(`${base}/api/slashed/`, { redirect: 'manual' })).status).toBe(200);
    const alt = await fetch(`${base}/api/slashed`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
    expect(alt.headers.get('Location')).toBeNull();
  });

  test('sse route is exempt: the declared slashless pattern streams instead of redirecting', async () => {
    const res = await fetch(`${base}/sse/ticks`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.text()).toContain('tick');

    const alt = await fetch(`${base}/sse/ticks/`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
  });

  test('ws route is exempt: the declared slashless pattern reaches the upgrade', async () => {
    const declared = await fetch(`${base}/ws/echo`, { redirect: 'manual' });
    expect(declared.status).not.toBe(404);
    expect(declared.headers.get('Location')).toBeNull();

    expect((await fetch(`${base}/ws/echo/`, { redirect: 'manual' })).status).toBe(404);
  });

  test('extensionless file route is exempt: the declared slashless pattern serves', async () => {
    const declared = await fetch(`${base}/files/report`, { redirect: 'manual' });
    expect(declared.status).toBe(200);
    expect(declared.headers.get('Location')).toBeNull();

    expect((await fetch(`${base}/files/report/`, { redirect: 'manual' })).status).toBe(404);
  });

  test('the trailingSlash:redirect filter never runs for any exempt kind', async () => {
    filteredPaths.length = 0;
    for (const p of ['/api/slashed', '/api/ping/', '/sse/ticks', '/sse/ticks/', '/ws/echo', '/ws/echo/', '/files/report', '/files/report/']) {
      await fetch(`${base}${p}`, { redirect: 'manual' });
    }
    expect(filteredPaths).toEqual([]);

    await fetch(`${base}/nope`, { redirect: 'manual' });
    expect(filteredPaths).toEqual(['/nope']);
  });
});
