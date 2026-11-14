// An island imported through a symlinked folder is spelled differently in Bun's metafile, so its CSS graph has to be
// found through the real path: neither left empty (its client-only child unstyled) nor widened to every stylesheet.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

const styled = (cls: string) => `<p class="${cls}">${cls}</p>\n\n<style>\n  .${cls} {\n    color: red;\n  }\n</style>\n`;

let root: string;
let page: string;
let registry: ComponentRegistry;

beforeAll(async () => {
  root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-css-paths-'));
  const src = path.join(root, 'src');
  mkdirSync(path.join(src, 'real'), { recursive: true });
  writeFileSync(path.join(src, 'real', 'Child.svelte'), styled('child'));
  writeFileSync(
    path.join(src, 'real', 'Linked.svelte'),
    `<script>\n  import Child from './Child.svelte';\n  let open = $state(false);\n</script>\n\n<button class="b" onclick={() => (open = !open)}>t</button>\n{#if open}<Child />{/if}\n\n<style>\n  .b {\n    color: red;\n  }\n</style>\n`,
  );
  writeFileSync(path.join(src, 'Never.svelte'), styled('never'));
  symlinkSync(path.join(src, 'real'), path.join(src, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  page = path.join(src, 'Page.svelte');
  writeFileSync(
    page,
    `<script>\n  import Linked from './link/Linked.svelte';\n  import Never from './Never.svelte';\n  let { show = false } = $props();\n</script>\n\n<Linked mochi:hydrate />\n{#if show}<Never />{/if}\n`,
  );
  registry = new ComponentRegistry({ development: true, outDir: path.join(root, '.mochi') });
  await registry.compile(page);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test('an island imported through a symlinked folder keeps its own CSS graph', async () => {
  expect(registry.getErrors()).toEqual([]);
  const { cssUrls } = await requestContext.run(makeCtx(), () => registry.renderComponent(page));
  const names = cssUrls.map((u) => path.basename(u).split('-')[0]).sort();
  expect(names).toEqual(['Child', 'Linked']);
});
