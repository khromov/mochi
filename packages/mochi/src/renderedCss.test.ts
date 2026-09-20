// Boots a dev-mode Mochi.serve() and checks that a page and a deferred-island fragment link stylesheets only for the
// components that rendered in that response, while a hydrated island keeps every stylesheet its client code may need.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { linkedCss } from './__fixtures__/rendered-css/linkedCss';

const FIXTURES = path.join(import.meta.dir, '__fixtures__', 'rendered-css');
const PAGE = path.join(FIXTURES, 'Page.svelte');

describe('rendered-only CSS links (dev)', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-rendered-css-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      liveReload: false,
      debugBar: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/': Mochi.page(PAGE, {
          serverProps: (req) => {
            const url = new URL(req.url);
            return { variant: url.searchParams.get('variant') ?? 'a', islands: url.searchParams.get('islands') !== '0' };
          },
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a page links the rendered variant, not the untaken branch or the never-rendered component', async () => {
    const html = await (await fetch(`${base}/?variant=a`)).text();
    const css = linkedCss(html);
    expect(css).toContain('Always');
    expect(css).toContain('VariantA');
    expect(css).not.toContain('VariantB');
    expect(css).not.toContain('Never');
    // The other variant flips the choice, so the pruning follows the render rather than the import graph.
    expect(linkedCss(await (await fetch(`${base}/?variant=b`)).text())).toContain('VariantB');
  });

  test('a component with :global rules stays linked even when it never rendered', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).not.toContain('data-global');
    expect(linkedCss(html)).toContain('Global');
  });

  test('a hydrated island keeps the stylesheets of its client-only branch and a clientOnly island keeps its own', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).not.toContain('data-hidden');
    const css = linkedCss(html);
    expect(css).toContain('Toggle');
    expect(css).toContain('Hidden');
    expect(css).toContain('Widget');
  });

  test('islands that did not render drop their whole subtree from the links', async () => {
    const css = linkedCss(await (await fetch(`${base}/?islands=0`)).text());
    expect(css).not.toContain('Toggle');
    expect(css).not.toContain('Hidden');
    expect(css).not.toContain('Widget');
  });

  test('a deferred island fragment links only the components it rendered', async () => {
    const html = await (await fetch(`${base}/`)).text();
    // The wrapper loads the island's own stylesheet through `css-url`, so the page head skips it.
    expect(linkedCss(html)).not.toContain('Deferred');
    const wrapper = html.match(/<mochi-server-island component-name="(Deferred_\w+)" signed-props="([^"]+)"[^>]*css-url="([^"]+)"/);
    expect(wrapper).not.toBeNull();
    const [, key, token, cssUrl] = wrapper!;
    expect(cssUrl).toContain('/_mochi/css/Deferred-');

    const res = await fetch(`${base}/_mochi/island/${key}?props=${encodeURIComponent(token!)}`);
    expect(res.status).toBe(200);
    const fragment = await res.text();
    expect(fragment).toContain('data-variant="b"');
    expect(linkedCss(fragment)).toEqual(['VariantB']);
  });
});
