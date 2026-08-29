import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getRequestContext } from './runtime/requestContext';

// Separate process (one Mochi.serve() per process) for the development-mode side of `secureCookies`. The option is
// deliberately not passed: it is on by default, and this pins that. HttpOnly/SameSite still apply in development, but
// Secure is dropped so cookies work over http://localhost.

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
      '/opt-out': Mochi.api(() => {
        getRequestContext().cookies.set('theme', 'dark', { httpOnly: false });
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

test('a per-cookie { httpOnly: false } still wins over the default', async () => {
  const res = await fetch(`http://localhost:${server.port}/opt-out`);
  const setCookie = (res.headers.get('set-cookie') ?? '').toLowerCase();
  expect(setCookie).toContain('theme=dark');
  expect(setCookie).not.toContain('httponly');
  expect(setCookie).toContain('samesite=lax');
});
