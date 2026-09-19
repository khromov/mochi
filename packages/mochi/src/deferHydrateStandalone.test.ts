// A page whose only hydratable island is deferred renders no island in its SSR output, so it ships no hydration
// bootstrap — the deferred fragment has to carry one. Asserts both halves of that contract; the client half (running
// a script that arrived through `innerHTML`) lives in web-components/ServerIslandScripts.client.test.ts.
// Separate file because Mochi.serve() is one-per-process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const FIXTURES = path.join(import.meta.dir, '__fixtures__', 'defer-hydrate-standalone');
const BOOTSTRAP = /<script type="module" src="\/_mochi\/client\/HydratableIsland-[^"]+\.js"><\/script>/;

describe("a deferred island is the page's only hydratable", () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  const islandHtml = async (pageHtml: string) => {
    const wrapper = pageHtml.match(/<mochi-server-island\b[^>]*>/)![0];
    const name = wrapper.match(/component-name="([^"]+)"/)![1]!;
    const props = wrapper.match(/signed-props="([^"]+)"/)![1]!;
    const res = await fetch(`${base}/_mochi/island/${name}?props=${encodeURIComponent(props)}`);
    expect(res.status).toBe(200);
    return { wrapper, body: await res.text() };
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-defer-hydrate-standalone-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/': Mochi.page(path.join(FIXTURES, 'Page.svelte')),
        '/visible': Mochi.page(path.join(FIXTURES, 'VisiblePage.svelte')),
        '/nested': Mochi.page(path.join(FIXTURES, 'NestedPage.svelte')),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('mochi:defer mochi:hydrate — the page ships no bootstrap and the fragment carries one', async () => {
    const page = await (await fetch(`${base}/`)).text();
    expect(page).not.toMatch(BOOTSTRAP);

    const { wrapper, body } = await islandHtml(page);
    expect(wrapper).toContain('also-hydrate="eager"');
    expect(body).toContain('<mochi-hydratable-island');
    expect(body).toMatch(BOOTSTRAP);
  });

  test('mochi:defer:visible mochi:hydrate — same, behind the observer', async () => {
    const page = await (await fetch(`${base}/visible`)).text();
    expect(page).not.toMatch(BOOTSTRAP);

    const { wrapper, body } = await islandHtml(page);
    expect(wrapper).toContain('defer-on="visible"');
    expect(body).toContain('<mochi-hydratable-island');
    expect(body).toMatch(BOOTSTRAP);
  });

  // A plain `mochi:defer` never hydrates itself, but a `mochi:hydrate` child rendered only inside the fragment does.
  test('a mochi:hydrate child inside a plain mochi:defer gets a bootstrap too', async () => {
    const page = await (await fetch(`${base}/nested`)).text();
    expect(page).not.toMatch(BOOTSTRAP);

    const { body } = await islandHtml(page);
    expect(body).toContain('<mochi-hydratable-island');
    expect(body).toMatch(BOOTSTRAP);
  });
});
