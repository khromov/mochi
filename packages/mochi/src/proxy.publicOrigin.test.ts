// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getRequestContext } from './requestContext';
import { json } from './utils';

describe('proxy.origin → event.url.origin', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-proxy-origin-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      proxy: { origin: 'https://my.site' },
      // CSRF rejects cross-origin POSTs by default; this test only does GETs.
      routes: {
        '/echo-origin': Mochi.api(async () => {
          const { url } = getRequestContext();
          return json({ origin: url.origin, href: url.href });
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('event.url.origin reflects proxy.origin, not the loopback request URL', async () => {
    const res = await fetch(`${base}/echo-origin`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { origin: string; href: string };
    expect(body.origin).toBe('https://my.site');
    expect(body.href).toBe('https://my.site/echo-origin');
  });
});
