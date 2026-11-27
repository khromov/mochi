import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// Development drops Secure so cookies still work over http://localhost.
describe('secureCookies: true in development', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-secure-cookies-dev-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      liveReload: false,
      debugBar: false,
      logger: { enabled: false },
      outDir,
      secureCookies: true,
      routes: {
        '/set': Mochi.api(({ cookies }) => {
          cookies.set('session', 'abc');
          return new Response('ok');
        }),
        '/set-readable': Mochi.api(({ cookies }) => {
          cookies.set('theme', 'dark', { httpOnly: false });
          return new Response('ok');
        }),
        '/delete': Mochi.api(({ cookies }) => {
          cookies.delete('session');
          return new Response('ok');
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  const setCookie = async (route: string): Promise<string[]> => (await fetch(`${base}${route}`)).headers.getSetCookie();

  test('a bare cookies.set() is HttpOnly and SameSite=Lax but not Secure', async () => {
    expect(await setCookie('/set')).toEqual(['session=abc; Path=/; HttpOnly; SameSite=Lax']);
  });

  test('a per-call { httpOnly: false } wins', async () => {
    expect(await setCookie('/set-readable')).toEqual(['theme=dark; Path=/; SameSite=Lax']);
  });

  test('a bare cookies.delete() clears the cookie', async () => {
    expect(await setCookie('/delete')).toEqual(['session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax']);
  });
});
