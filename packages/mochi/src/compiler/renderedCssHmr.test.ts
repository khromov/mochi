// A dev-watcher rebuild re-derives both halves of the pruning data: which components report their render (a component
// gaining `:global` rules stops being pruned) and each island's static CSS graph (a dropped child leaves the links).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext, type MochiRequestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

function makeCtx(): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    getClientAddress: () => null,
  };
}

const names = (urls: string[]) => urls.map((u) => path.basename(u).split('-')[0]!).sort();

describe('rendered-only CSS links survive HMR recompiles', () => {
  let root: string;
  let src: string;
  let registry: ComponentRegistry;
  let page: string;

  const render = async () => names((await requestContext.run(makeCtx(), () => registry.renderComponent(page, { variant: 'a' }))).cssUrls);

  beforeAll(async () => {
    root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-rendered-css-hmr-'));
    src = path.join(root, 'src');
    cpSync(path.join(import.meta.dir, '..', '__fixtures__', 'rendered-css'), src, { recursive: true });
    page = path.join(src, 'Page.svelte');
    // The shared fixture page also defers an island, which needs the `Mochi.serve()` key; this registry-only test drops it.
    writeFileSync(
      page,
      [
        '<script lang="ts">',
        "  import Always from './Always.svelte';",
        "  import Never from './Never.svelte';",
        "  import Global from './Global.svelte';",
        "  import VariantA from './VariantA.svelte';",
        "  import VariantB from './VariantB.svelte';",
        "  import Toggle from './Toggle.svelte';",
        "  import Widget from './Widget.svelte';",
        '  let { variant }: { variant: string } = $props();',
        '</script>',
        '<Always />',
        "{#if variant === 'a'}<VariantA />{:else}<VariantB />{/if}",
        "{#if variant === 'never'}<Never /><Global />{/if}",
        '<Toggle mochi:hydrate />',
        '<Widget mochi:clientOnly />',
      ].join('\n'),
    );
    registry = new ComponentRegistry({ development: true, outDir: path.join(root, '.mochi') });
    await registry.compile(page);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('baseline: untaken branches are pruned, island subtrees are kept', async () => {
    const css = await render();
    expect(css).toEqual(expect.arrayContaining(['Always', 'VariantA', 'Global', 'Toggle', 'Hidden', 'Widget']));
    expect(css).not.toContain('Never');
    expect(css).not.toContain('VariantB');
  });

  test('a component that gains :global rules is linked again after its rebuild', async () => {
    writeFileSync(path.join(src, 'Never.svelte'), `<p data-never>never</p>\n\n<style>\n  :global(html) {\n    scroll-behavior: smooth;\n  }\n</style>\n`);
    const { pages } = await registry.recompileChanged(path.join(src, 'Never.svelte'));
    expect(pages.has(page)).toBe(true);
    expect(await render()).toContain('Never');
  });

  test('a child dropped from an island leaves the island links after the rebuild', async () => {
    writeFileSync(path.join(src, 'Toggle.svelte'), `<button data-toggle>toggle</button>\n\n<style>\n  [data-toggle] {\n    color: darkgreen;\n  }\n</style>\n`);
    await registry.recompileChanged(path.join(src, 'Toggle.svelte'));
    const css = await render();
    expect(css).toContain('Toggle');
    expect(css).not.toContain('Hidden');
  });
});
