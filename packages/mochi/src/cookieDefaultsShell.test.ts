import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// The client cookie jar can only apply `cookie:defaults` if the shell hands them to the page.
describe('cookie:defaults reach the client cookie jar', () => {
  let server: Server<undefined>;
  let outDir: string;
  let port: number;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-cookie-defaults-shell-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      debugBar: false,
      outDir,
      filters: {
        'cookie:defaults': () => ({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/</script>', maxAge: 60 }),
      },
      routes: {
        '/': Mochi.page(path.join(import.meta.dir, '__fixtures__', 'shell-placeholder', 'Page.svelte')),
      },
    });
    if (server.port == null) {
      throw new Error('server.port not set');
    }
    port = server.port;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the shell seeds the client-applicable defaults, escaped for a script tag', async () => {
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    expect(html).toContain('<script>window.__mochi_cookie_defaults={"path":"/\\u003c/script>","secure":true,"sameSite":"Strict"}</script>');
  });
});
