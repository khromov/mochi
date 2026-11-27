import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './compiler/ComponentRegistry';
import { requestContext } from './runtime/requestContext';
import { MochiCookieJar } from './runtime/cookies';

// A legacy-mode (`export let`, `$:`) island whose root and child both auto-subscribe to one module-level
// `svelte/store` — a pattern a real-world app removed after blaming it for a hydration error. Nothing in the
// demos or the suite used `svelte/store` inside an island before this file.
describe('legacy-mode island sharing a module-level svelte/store with its child', () => {
  let dir: string;
  let registry: ComponentRegistry;
  let page: string;

  const render = () => {
    const ctx = {
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
    return requestContext.run(ctx, () => registry.renderComponent(page));
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-legacy-store-'));
    writeFileSync(
      path.join(dir, 'stores.ts'),
      `import { derived, writable } from 'svelte/store';
export const selected = writable<string | null>(null);
export const label = derived(selected, ($s) => ($s ? \`picked:\${$s}\` : 'none'));
`,
    );
    writeFileSync(
      path.join(dir, 'Child.svelte'),
      `<script lang="ts">
  import { label } from './stores.ts';
  export let fallback: string = '';
  $: text = $label === 'none' ? fallback : $label;
</script>

<p data-testid="child">{text}</p>
`,
    );
    writeFileSync(
      path.join(dir, 'Root.svelte'),
      `<script lang="ts">
  import { label, selected } from './stores.ts';
  import Child from './Child.svelte';
  export let items: string[] = [];
  $: if (items.length > 0 && !$selected) selected.set(items[0]);
</script>

<ul>
  {#each items as item}
    <li class:on={$selected === item}>{item}</li>
  {/each}
</ul>
<Child fallback="nothing" />
<span data-testid="root">{$label}</span>
`,
    );
    page = path.join(dir, 'Page.svelte');
    writeFileSync(page, `<script lang="ts">\n  import Root from './Root.svelte';\n</script>\n\n<Root mochi:hydrate items={['a', 'b']} />\n`);
    registry = new ComponentRegistry({ development: true, outDir: path.join(dir, '.mochi') });
    await registry.compile(page);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('SSR: root and child read the same store instance', async () => {
    const result = await render();
    expect(result.body).toContain('<span data-testid="root">picked:a</span>');
    expect(result.body).toContain('<p data-testid="child">picked:a</p>');
    expect(result.body).toContain('class="on');
  });

  test('client: the island bundles, and the store module is bundled exactly once', async () => {
    const result = await render();
    expect(result.bootstrapUrl).toBeTruthy();
    const stats = registry.getClientStats();
    expect(stats).not.toBeNull();
    const storeInputs = stats!.outputs.flatMap((o) => o.inputs.map((i) => i.path)).filter((p) => p.endsWith('/stores.ts'));
    expect(storeInputs).toHaveLength(1);
  });
});
