// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { json } from '../utils';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'css-imports', 'Page.svelte');

describe('trailingSlash: "never"', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-trailing-slash-never-'));
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
        '/api/ping': Mochi.api(async () => json({ ok: true })),
        '/api/users/:id': Mochi.api(async () => json({ ok: true })),
        '/sse/ticks': Mochi.sse((stream) => {
          stream.send('tick');
          stream.close();
        }),
        '/ws/echo': Mochi.ws({ message() {} }),
        '/files/report': Mochi.file(FIXTURE_PAGE),
        '/files/dyn/:name': Mochi.file(() => FIXTURE_PAGE),
        '/data.txt': Mochi.file(FIXTURE_PAGE),
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

  test('HEAD trailing-slash form 301s to canonical with an empty body', async () => {
    const res = await fetch(`${base}/about/`, { method: 'HEAD', redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/about');
    expect(await res.text()).toBe('');
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

  test('a parameterised api route is exempt on the same terms as a literal one', async () => {
    expect((await fetch(`${base}/api/users/5`, { redirect: 'manual' })).status).toBe(200);
    const alt = await fetch(`${base}/api/users/5/`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
  });

  test('sse route is exempt: declared pattern streams, alt-slash form 404s', async () => {
    const res = await fetch(`${base}/sse/ticks`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('tick');

    const alt = await fetch(`${base}/sse/ticks/`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
    expect(alt.headers.get('Location')).toBeNull();
  });

  test('ws route is exempt: declared pattern reaches the upgrade, alt-slash form 404s', async () => {
    // A plain GET can't upgrade, so the declared pattern fails inside the handler rather than
    // redirecting — asserting "reached a handler at all" keeps this off that failure's exact status.
    const declared = await fetch(`${base}/ws/echo`, { redirect: 'manual' });
    expect(declared.status).not.toBe(404);
    expect(declared.headers.get('Location')).toBeNull();

    const alt = await fetch(`${base}/ws/echo/`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
    expect(alt.headers.get('Location')).toBeNull();
  });

  test('extensionless file route is exempt: declared pattern serves, alt-slash form 404s', async () => {
    expect((await fetch(`${base}/files/report`, { redirect: 'manual' })).status).toBe(200);

    const alt = await fetch(`${base}/files/report/`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
    expect(alt.headers.get('Location')).toBeNull();
  });

  test('a parameterised exempt route of a non-api kind is exempt too', async () => {
    expect((await fetch(`${base}/files/dyn/report`, { redirect: 'manual' })).status).toBe(200);

    const alt = await fetch(`${base}/files/dyn/report/`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
    expect(alt.headers.get('Location')).toBeNull();
  });

  test('an extensioned file route 404s its slashed form rather than redirecting to the bare one', async () => {
    // The extension carve-out stops `/data.txt` itself from ever being redirected, but `/data.txt/`
    // has no extension to match, so before the exemption it 301'd back to the bare form.
    expect((await fetch(`${base}/data.txt`, { redirect: 'manual' })).status).toBe(200);

    const alt = await fetch(`${base}/data.txt/`, { redirect: 'manual' });
    expect(alt.status).toBe(404);
    expect(alt.headers.get('Location')).toBeNull();
  });

  test('unmatched paths are not redirected: both slash forms 404 as-is', async () => {
    for (const p of ['/nope', '/nope/']) {
      const res = await fetch(`${base}${p}`, { redirect: 'manual' });
      expect(res.status).toBe(404);
      expect(res.headers.get('Location')).toBeNull();
    }
  });
});
