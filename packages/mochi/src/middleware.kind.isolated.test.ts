import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { Handle, MochiEventKind } from './hooks';

// `*.isolated.test.ts` runs in its own `bun test` invocation:
// `initMochiConfig()` pins state on `globalThis.__mochi_config__` and throws if
// `Mochi.serve()` is called twice in one process.

// Fixture has a `mochi:hydrate` child so the page renders with a
// `/_mochi/client/...js` bundle script — the asset test below scrapes it.
const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'middleware-kind', 'Page.svelte');

describe('event.kind on Handle middleware', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const seen: Array<{ pathname: string; kind: MochiEventKind }> = [];

  const recorder: Handle = async ({ event, resolve }) => {
    seen.push({ pathname: event.url.pathname, kind: event.kind });
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
        '/api': Mochi.api(async () => Response.json({ ok: true })),
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
  });

  test("unmatched URL with userFetch → kind 'fallback'", async () => {
    const res = await fetch(`${base}/nope`);
    expect(await res.text()).toBe('user-fetch-handled');
    expect(lastKindFor('/nope')).toBe('fallback');
  });
});
