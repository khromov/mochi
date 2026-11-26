import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// Production side of `secureCookies`; development, the `cookie:defaults` interplay and the default live in their own processes.
describe('secureCookies: true in production', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-secure-cookies-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      secureCookies: true,
      routes: {
        '/': Mochi.page(path.join(import.meta.dir, '__fixtures__', 'shell-placeholder', 'Page.svelte')),
        '/set': Mochi.api(({ cookies }) => {
          cookies.set('session', 'abc');
          return new Response('ok');
        }),
        '/set-readable': Mochi.api(({ cookies }) => {
          cookies.set('theme', 'dark', { httpOnly: false });
          return new Response('ok');
        }),
        '/set-plain-http': Mochi.api(({ cookies }) => {
          cookies.set('theme', 'dark', { secure: false });
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

  test('a bare cookies.set() is Secure, HttpOnly and SameSite=Lax', async () => {
    expect(await setCookie('/set')).toEqual(['session=abc; Path=/; Secure; HttpOnly; SameSite=Lax']);
  });

  test('a per-call option wins over the field it names and keeps the rest', async () => {
    expect(await setCookie('/set-readable')).toEqual(['theme=dark; Path=/; Secure; SameSite=Lax']);
    expect(await setCookie('/set-plain-http')).toEqual(['theme=dark; Path=/; HttpOnly; SameSite=Lax']);
  });

  test('a bare cookies.delete() carries the same attributes, so the browser clears the cookie', async () => {
    expect(await setCookie('/delete')).toEqual(['session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax']);
  });

  test('the browser jar is seeded with Secure and SameSite but never HttpOnly', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<script>window.__mochi_cookie_defaults={"secure":true,"sameSite":"lax"}</script>');
  });
});
