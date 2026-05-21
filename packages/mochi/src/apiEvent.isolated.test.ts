import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// `*.isolated.test.ts` runs in its own `bun test` invocation:
// `initMochiConfig()` pins state on `globalThis.__mochi_config__` and throws if
// `Mochi.serve()` is called twice in one process.

describe('Mochi.api event surface', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-api-event-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/api/items/:id': Mochi.api(({ method, params, cookies, url }) => {
          const id = params.id ?? '';
          cookies.set('seen', id, { path: '/' });
          return Response.json({
            method,
            id,
            tab: url.searchParams.get('tab'),
            session: cookies.get('session'),
          });
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('params resolves from the route pattern', async () => {
    const res = await fetch(`${base}/api/items/abc?tab=details`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { method: string; id: string; tab: string | null; session: string | null };
    expect(body.method).toBe('GET');
    expect(body.id).toBe('abc');
    expect(body.tab).toBe('details');
  });

  test('cookies reads request cookies and writes response cookies', async () => {
    const res = await fetch(`${base}/api/items/42`, {
      headers: { cookie: 'session=tok' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: string | null };
    expect(body.session).toBe('tok');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('seen=42');
  });
});
