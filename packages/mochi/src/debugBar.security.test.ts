import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getRequestContext } from './runtime/requestContext';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('debug bar secret redaction', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-debug-security-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      liveReload: false,
      logger: { enabled: false },
      outDir,
      handle: async ({ event, resolve }) => {
        getRequestContext().cookies.set('outbound-session', 'outbound-super-secret', {
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        });
        return resolve(event);
      },
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('does not serialize inbound or Set-Cookie values into client-readable HTML', async () => {
    const response = await fetch(base, {
      headers: { Cookie: 'incoming-session=inbound-super-secret' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('outbound-session=outbound-super-secret');

    const html = await response.text();
    expect(html).not.toContain('inbound-super-secret');
    expect(html).not.toContain('outbound-super-secret');
    expect(html).toContain('incoming-session');
    expect(html).toContain('outbound-session=\\u003credacted>');
    expect(html).toContain('HttpOnly');
  });
});
