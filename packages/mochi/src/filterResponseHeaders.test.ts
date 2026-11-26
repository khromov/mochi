import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { Handle } from './runtime/hooks';

describe('filterResponseHeaders keeps every Set-Cookie header', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  const handle: Handle = ({ event, resolve }) => resolve(event, { filterResponseHeaders: (name) => name !== 'x-secret' });

  function twoCookies(): Response {
    const headers = new Headers({ 'Content-Type': 'text/plain', 'X-Secret': 'drop-me' });
    headers.append('Set-Cookie', 'session=abc; Path=/');
    headers.append('Set-Cookie', 'csrf=xyz; Path=/');
    return new Response('ok', { headers });
  }

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-filter-headers-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      handle,
      fetch: () => twoCookies(),
      routes: {
        '/api': Mochi.api(() => twoCookies()),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test.each(['/api', '/unmatched'])('%s', async (pathname) => {
    const res = await fetch(`${base}${pathname}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-secret')).toBeNull();
    expect(res.headers.getSetCookie()).toEqual(['session=abc; Path=/', 'csrf=xyz; Path=/']);
  });
});
