import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getRequestContext } from './requestContext';

// Separate process (one Mochi.serve() per process) for the development-mode
// cookie behavior: HttpOnly/SameSite still apply, but Secure is dropped so
// cookies work over http://localhost.

let server: Server<undefined>;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-cookie-dev-'));
  server = await Mochi.serve({
    port: 0,
    development: true,
    logger: { enabled: false },
    outDir,
    routes: {
      '/set': Mochi.api(() => {
        getRequestContext().cookies.set('session', 'abc');
        return new Response('ok');
      }),
    },
  });
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

test('development: cookie keeps HttpOnly/SameSite but drops Secure', async () => {
  const res = await fetch(`http://localhost:${server.port}/set`);
  const setCookie = (res.headers.get('set-cookie') ?? '').toLowerCase();
  expect(setCookie).toContain('httponly');
  expect(setCookie).toContain('samesite=lax');
  expect(setCookie).not.toContain('secure');
});
