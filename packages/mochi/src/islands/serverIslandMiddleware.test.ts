// The server-island endpoint renders island components on its own request, so it must go through the same `handle`
// chain as the page that emitted it, and must refuse a request that carries no server-minted props token.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import type { Handle, MochiEventKind } from '../runtime/hooks';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'server-island-middleware', 'Page.svelte');
const SESSION = { Cookie: 'session=ok' };

describe('server island endpoint and handle middleware', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let islandKey: string;
  let token: string;
  const seen: Array<{ pathname: string; kind: MochiEventKind }> = [];

  const auth: Handle = async ({ event, resolve }) => {
    seen.push({ pathname: event.url.pathname, kind: event.kind });
    if (event.kind === 'asset') {
      return resolve(event);
    }
    if (event.request.headers.get('Cookie') !== 'session=ok') {
      return new Response('Unauthorized', { status: 401 });
    }
    event.locals.user = 'alice';
    return resolve(event);
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-middleware-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      handle: auth,
      routes: {
        '/admin': Mochi.page(FIXTURE_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;

    const html = await (await fetch(`${base}/admin`, { headers: SESSION })).text();
    islandKey = html.match(/<mochi-server-island\b[^>]*component-name="([^"]+)"/)![1]!;
    token = html.match(/<mochi-server-island\b[^>]*signed-props="([^"]+)"/)![1]!;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the host page itself is gated', async () => {
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(401);
  });

  test('an unauthenticated island fetch is stopped by the handle chain', async () => {
    const res = await fetch(`${base}/_mochi/island/${islandKey}?props=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('secret-data');
  });

  test('an unauthenticated island fetch without a token renders nothing', async () => {
    const res = await fetch(`${base}/_mochi/island/${islandKey}`);
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('secret-data');
  });

  test('an island fetch without a token is refused even when the handle chain lets it through', async () => {
    const res = await fetch(`${base}/_mochi/island/${islandKey}`, { headers: SESSION });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('secret-data');
  });

  test("an authenticated island fetch sees middleware locals and reports kind 'island'", async () => {
    const res = await fetch(`${base}/_mochi/island/${islandKey}?props=${encodeURIComponent(token)}`, { headers: SESSION });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('secret-data for alice');
    expect(seen.findLast((s) => s.pathname === `/_mochi/island/${islandKey}`)?.kind).toBe('island');
  });
});
