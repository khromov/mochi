import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { CookieSerializeOptions } from './runtime/cookies';

describe('secureCookies with a cookie:defaults filter', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let received: CookieSerializeOptions | undefined;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-secure-cookies-filter-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      secureCookies: true,
      filters: {
        'cookie:defaults': (defaults) => {
          received = { ...defaults };
          return { ...defaults, sameSite: 'Strict' };
        },
      },
      routes: {
        '/': Mochi.page(path.join(import.meta.dir, '__fixtures__', 'shell-placeholder', 'Page.svelte')),
        '/set': Mochi.api(({ cookies }) => {
          cookies.set('session', 'abc');
          return new Response('ok');
        }),
        '/set-override': Mochi.api(({ cookies }) => {
          cookies.set('theme', 'dark', { sameSite: 'Lax', httpOnly: false });
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

  test('the filter receives the secureCookies fields', () => {
    expect(received).toEqual({ httpOnly: true, sameSite: 'lax', secure: true });
  });

  test('a field the filter returns wins over secureCookies', async () => {
    expect(await setCookie('/set')).toEqual(['session=abc; Path=/; Secure; HttpOnly; SameSite=Strict']);
  });

  test('a per-call option still wins over the filter', async () => {
    expect(await setCookie('/set-override')).toEqual(['theme=dark; Path=/; Secure; SameSite=Lax']);
  });

  test('the browser jar is seeded from the filtered value', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<script>window.__mochi_cookie_defaults={"secure":true,"sameSite":"Strict"}</script>');
  });
});
