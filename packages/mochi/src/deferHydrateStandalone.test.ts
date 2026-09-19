// A page whose only hydratable island is deferred renders no island in its SSR output, so it ships no hydration
// bootstrap — the deferred fragment has to name one. Asserts the server half of that contract: the fragment leads
// with the `data-mochi-bootstrap` marker and carries no inert `<script>`. The client half (importing what the marker
// names) lives in web-components/ServerIslandBootstrap.client.test.ts. Separate file because Mochi.serve() is
// one-per-process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { BOOTSTRAP_MARKER_ATTR } from './islands/bootstrapMarker';

const FIXTURES = path.join(import.meta.dir, '__fixtures__', 'defer-hydrate-standalone');
const BOOTSTRAP_SCRIPT = /<script type="module" src="(\/_mochi\/client\/HydratableIsland-[^"]+\.js)"><\/script>/;
const MARKER = new RegExp(`^<template ${BOOTSTRAP_MARKER_ATTR}="(\\/_mochi\\/client\\/HydratableIsland-[^"]+\\.js)"><\\/template>`);

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
        '/plain': Mochi.page(path.join(FIXTURES, 'PlainPage.svelte')),
        '/hydrated': Mochi.page(path.join(FIXTURES, 'HydratedPage.svelte')),
        '/mixed': Mochi.page(path.join(FIXTURES, 'MixedPage.svelte')),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('mochi:defer mochi:hydrate — the page ships no bootstrap and the fragment leads with the marker', async () => {
    const page = await (await fetch(`${base}/`)).text();
    expect(page).not.toMatch(BOOTSTRAP_SCRIPT);

    const { wrapper, body } = await islandHtml(page);
    expect(wrapper).toContain('also-hydrate="eager"');
    expect(body).toMatch(MARKER);
    expect(body).toContain('<mochi-hydratable-island');
    expect(body).not.toContain('<script');
  });

  test('mochi:defer:visible mochi:hydrate — same, behind the observer', async () => {
    const page = await (await fetch(`${base}/visible`)).text();
    expect(page).not.toMatch(BOOTSTRAP_SCRIPT);

    const { wrapper, body } = await islandHtml(page);
    expect(wrapper).toContain('defer-on="visible"');
    expect(body).toMatch(MARKER);
    expect(body).toContain('<mochi-hydratable-island');
    expect(body).not.toContain('<script');
  });

  // A plain `mochi:defer` never hydrates itself, but a `mochi:hydrate` child rendered only inside the fragment does.
  test('a mochi:hydrate child inside a plain mochi:defer gets the marker too', async () => {
    const page = await (await fetch(`${base}/nested`)).text();
    expect(page).not.toMatch(BOOTSTRAP_SCRIPT);

    const { body } = await islandHtml(page);
    expect(body).toMatch(MARKER);
    expect(body).toContain('<mochi-hydratable-island');
    expect(body).not.toContain('<script');
  });

  test('a fragment with nothing to hydrate carries no marker', async () => {
    const page = await (await fetch(`${base}/plain`)).text();
    const { body } = await islandHtml(page);
    expect(body).toContain('<p class="static">');
    expect(body).not.toContain(BOOTSTRAP_MARKER_ATTR);
    expect(body).not.toContain('<script');
  });

  // The client dedupes through the module map, which keys on the URL: the marker has to name the very module a page
  // with an in-page island ships, or a page that already has the bootstrap would load it a second time.
  test('the marker names the same module the page bootstrap ships', async () => {
    const hydrated = await (await fetch(`${base}/hydrated`)).text();
    const shipped = hydrated.match(BOOTSTRAP_SCRIPT)![1];

    const page = await (await fetch(`${base}/`)).text();
    const { body } = await islandHtml(page);
    expect(body.match(MARKER)![1]).toBe(shipped);
  });

  // The endpoint cannot tell whether the page shipped the bootstrap, so it always signals; the module map on the
  // client is what keeps a page that did from loading it twice.
  test('a page that ships the bootstrap still gets the marker, naming the same module', async () => {
    const page = await (await fetch(`${base}/mixed`)).text();
    const shipped = page.match(BOOTSTRAP_SCRIPT)![1];

    const { body } = await islandHtml(page);
    expect(body.match(MARKER)![1]).toBe(shipped);
  });
});
