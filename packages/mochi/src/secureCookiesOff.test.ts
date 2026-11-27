import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// `secureCookies` is opt-in: an app that does not pass it keeps Bun's bare cookie attributes.
describe('secureCookies left unset', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-secure-cookies-off-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/': Mochi.page(path.join(import.meta.dir, '__fixtures__', 'shell-placeholder', 'Page.svelte')),
        '/set': Mochi.api(({ cookies }) => {
          cookies.set('session', 'abc');
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

  test('a bare cookies.set() adds no HttpOnly or Secure', async () => {
    const res = await fetch(`${base}/set`);
    expect(res.headers.getSetCookie()).toEqual(['session=abc; Path=/; SameSite=Lax']);
  });

  test('the browser jar is not seeded', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).not.toContain('__mochi_cookie_defaults');
  });
});
