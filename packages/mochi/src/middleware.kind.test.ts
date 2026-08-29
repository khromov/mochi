// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { Handle, MochiEventKind } from './runtime/hooks';

// Fixture has a `mochi:hydrate` child so the page renders with a
// `/_mochi/client/...js` bundle script — the asset test below scrapes it.
const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'middleware-kind', 'Page.svelte');
const ISLAND_PAGE = path.join(import.meta.dir, '__fixtures__', 'server-island-endpoint', 'Page.svelte');
const FILE_PATH = path.join(import.meta.dir, '..', 'README.md');
const HeaderWebSocket = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;

describe('event.kind on Handle middleware', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const seen: Array<{ pathname: string; kind: MochiEventKind }> = [];

  const recorder: Handle = async ({ event, resolve }) => {
    seen.push({ pathname: event.url.pathname, kind: event.kind });
    if (event.request.headers.get('x-deny') === '1') {
      return new Response('blocked-by-handle', { status: 401 });
    }
    return resolve(event);
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-middleware-kind-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      handle: recorder,
      fetch: () => new Response('user-fetch-handled', { status: 200 }),
      routes: {
        '/page': Mochi.page(FIXTURE_PAGE),
        '/island-page': Mochi.page(ISLAND_PAGE),
        '/api': Mochi.api(async () => Response.json({ ok: true })),
        '/file': Mochi.file(FILE_PATH),
        '/events': Mochi.sse((stream) => {
          stream.send('hello');
          stream.close();
        }),
        '/socket': Mochi.ws({ message() {} }),
        '/raw': () => new Response('raw'),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  function lastKindFor(pathname: string): MochiEventKind | undefined {
    for (let i = seen.length - 1; i >= 0; i--) {
      if (seen[i]!.pathname === pathname) {
        return seen[i]!.kind;
      }
    }
    return undefined;
  }

  test("page route → kind 'page'", async () => {
    const res = await fetch(`${base}/page`);
    expect(res.status).toBe(200);
    expect(lastKindFor('/page')).toBe('page');
  });

  test("api route → kind 'api'", async () => {
    const res = await fetch(`${base}/api`);
    expect(res.status).toBe(200);
    expect(lastKindFor('/api')).toBe('api');
  });

  test("file route → kind 'file'", async () => {
    expect((await fetch(`${base}/file`)).status).toBe(200);
    expect(lastKindFor('/file')).toBe('file');
  });

  test("SSE route → kind 'sse'", async () => {
    const res = await fetch(`${base}/events`);
    expect(res.status).toBe(200);
    await res.text();
    expect(lastKindFor('/events')).toBe('sse');
  });

  test("raw Bun route → kind 'raw'", async () => {
    expect((await fetch(`${base}/raw`)).status).toBe(200);
    expect(lastKindFor('/raw')).toBe('raw');
  });

  test("server-island endpoint → kind 'island'", async () => {
    const html = await (await fetch(`${base}/island-page`)).text();
    const wrapper = html.match(/<mochi-server-island\b[^>]*>/)?.[0];
    const componentName = wrapper?.match(/component-name="([^"]+)"/)?.[1];
    const token = wrapper?.match(/signed-props="([^"]+)"/)?.[1];
    expect(componentName).toBeTruthy();
    expect(token).toBeTruthy();
    const path = `/_mochi/island/${componentName}?props=${encodeURIComponent(token!)}`;
    expect((await fetch(`${base}${path}`)).status).toBe(200);
    expect(lastKindFor(`/_mochi/island/${componentName}`)).toBe('island');
  });

  test("WebSocket upgrade → kind 'ws'", async () => {
    const ws = new HeaderWebSocket(`${base.replace('http:', 'ws:')}/socket`, {
      headers: { Origin: base },
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket did not open')), { once: true });
    });
    ws.close();
    expect(lastKindFor('/socket')).toBe('ws');
  });

  test('middleware can deny every formerly bypassing route before its handler runs', async () => {
    const denied = { headers: { 'x-deny': '1', Origin: base } };
    for (const pathname of ['/file', '/events', '/raw', '/socket']) {
      const res = await fetch(`${base}${pathname}`, denied);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('blocked-by-handle');
    }

    const html = await (await fetch(`${base}/island-page`)).text();
    const wrapper = html.match(/<mochi-server-island\b[^>]*>/)?.[0] ?? '';
    const componentName = wrapper.match(/component-name="([^"]+)"/)?.[1] ?? '';
    const token = wrapper.match(/signed-props="([^"]+)"/)?.[1] ?? '';
    const island = await fetch(`${base}/_mochi/island/${componentName}?props=${encodeURIComponent(token)}`, denied);
    expect(island.status).toBe(401);
    expect(await island.text()).toBe('blocked-by-handle');
  });

  test('middleware runs before built-in CSRF guards', async () => {
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://attacker.example',
    };
    const rejected = await fetch(`${base}/raw`, { method: 'POST', headers, body: 'x=1' });
    expect(rejected.status).toBe(403);

    const handled = await fetch(`${base}/raw`, {
      method: 'POST',
      headers: { ...headers, 'x-deny': '1' },
      body: 'x=1',
    });
    expect(handled.status).toBe(401);
    expect(await handled.text()).toBe('blocked-by-handle');
  });

  test("framework asset → kind 'asset'", async () => {
    // Bundle filenames are content-hashed, so we can't hardcode one. Render
    // the page first, scrape a script src out of the HTML, then fetch that
    // bundle and assert middleware classified it as kind 'asset'.
    const pageHtml = await (await fetch(`${base}/page`)).text();
    const match = pageHtml.match(/src="(\/_mochi\/client\/[^"]+\.js)"/);
    expect(match).not.toBeNull();
    const bundlePath = match![1]!;
    const res = await fetch(`${base}${bundlePath}`);
    expect(res.status).toBe(200);
    expect(lastKindFor(bundlePath)).toBe('asset');

    const denied = await fetch(`${base}${bundlePath}`, { headers: { 'x-deny': '1' } });
    expect(denied.status).toBe(401);
    expect(await denied.text()).toBe('blocked-by-handle');
  });

  test("unmatched URL with userFetch → kind 'fallback'", async () => {
    const res = await fetch(`${base}/nope`);
    expect(await res.text()).toBe('user-fetch-handled');
    expect(lastKindFor('/nope')).toBe('fallback');
  });
});
