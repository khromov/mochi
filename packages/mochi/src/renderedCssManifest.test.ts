// The prebuilt path: `build()` records which components report their render and each island's static CSS graph in the
// manifest, and a production server booted from it prunes exactly like the dev server does (see renderedCss.test.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from './cli/build';
import { Mochi } from './Mochi';
import { mochiEvents } from './events';
import { encodeSourcePath } from './compiler/manifestPaths';
import type { MochiManifest } from './types';
import { linkedCss } from './__fixtures__/rendered-css/linkedCss';

const FIXTURES = path.join(import.meta.dir, '__fixtures__', 'rendered-css');
const PAGE = path.join(FIXTURES, 'Page.svelte');
const routes = {
  '/': Mochi.page(PAGE, {
    serverProps: (req: Request) => ({ variant: new URL(req.url).searchParams.get('variant') ?? 'a' }),
  }),
};

describe('rendered-only CSS links (prebuilt manifest)', () => {
  let outDir: string;
  let manifest: MochiManifest;
  let server: Server<undefined>;
  let base: string;
  const compiled: string[] = [];
  const onCompile = ({ path: p }: { path: string }) => compiled.push(p);

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-rendered-css-manifest-'));
    await build({ routes, development: false, outDir });
    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
    mochiEvents.on('compile:complete', onCompile);
    server = await Mochi.serve({ port: 0, development: false, warmup: false, logger: { enabled: false }, outDir, routes });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    mochiEvents.off('compile:complete', onCompile);
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the manifest carries the tracked components and the island CSS graphs', () => {
    const key = (name: string) => encodeSourcePath(path.join(FIXTURES, name));
    expect(manifest.trackedCss).toContain(key('Never.svelte'));
    expect(manifest.trackedCss).toContain(key('VariantA.svelte'));
    expect(manifest.trackedCss).not.toContain(key('Global.svelte'));
    expect(manifest.islandCss?.[key('Toggle.svelte')]?.sort()).toEqual([key('Hidden.svelte'), key('Toggle.svelte')]);
    expect(manifest.islandCss?.[key('Widget.svelte')]).toEqual([key('Widget.svelte')]);
    // Guards against a vacuous pass below: the pruned components are in the page's static graph.
    expect(manifest.components[key('Page.svelte')]?.cssComponents).toContain(key('Never.svelte'));
    for (const p of manifest.trackedCss ?? []) {
      expect(p).not.toContain('\\');
    }
  });

  test('the page prunes like dev, from the manifest alone', async () => {
    const css = linkedCss(await (await fetch(`${base}/?variant=b`)).text());
    expect(css).toEqual(expect.arrayContaining(['Always', 'VariantB', 'Global', 'Toggle', 'Hidden', 'Widget']));
    expect(css).not.toContain('VariantA');
    expect(css).not.toContain('Never');
    expect(css).not.toContain('Deferred');
    expect(compiled.filter((p) => p.startsWith(FIXTURES))).toEqual([]);
  });

  test('the deferred fragment prunes like dev', async () => {
    const html = await (await fetch(`${base}/`)).text();
    const wrapper = html.match(/<mochi-server-island component-name="(Deferred_\w+)" signed-props="([^"]+)"/);
    expect(wrapper).not.toBeNull();
    const fragment = await (await fetch(`${base}/_mochi/island/${wrapper![1]}?props=${encodeURIComponent(wrapper![2]!)}`)).text();
    expect(linkedCss(fragment)).toEqual(['VariantB']);
  });
});
