import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

// Svelte 5's native TS stripping is incomplete — constructor parameter properties
// (`constructor(private x)`) make `svelte/compiler` throw outright. Mochi runs
// Bun's transpiler over `<script lang="ts">` before compilation, so these compile.
// The fixture also imports a child used ONLY in the template, proving Bun's
// transpiler doesn't tree-shake template-only value imports out of the script.
describe('<script lang="ts"> is fully transpiled by Bun before compilation', () => {
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
    // Under packages/mochi so the fixture's bare `svelte` import resolves.
    dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-ts-strip-'));
    page = path.join(dir, 'Page.svelte');
    writeFileSync(path.join(dir, 'Probe.svelte'), '<span data-testid="probe">PROBE_RENDERED</span>\n');
    writeFileSync(
      page,
      `<script lang="ts">
  import Probe from './Probe.svelte';
  class Box {
    constructor(private value = 41) {}
    get next() { return this.value + 1; }
  }
  const box = new Box();
</script>

<p>{box.next}</p>
<Probe />
`,
    );
    registry = new ComponentRegistry({ development: true, outDir: path.join(dir, '.mochi') });
    await registry.compile(page);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('compiles a TS construct svelte cannot strip natively and renders it', async () => {
    const result = await render();
    // Parameter property survived transpilation → `value` got assigned, `next` is 42.
    expect(result.body).toContain('42');
    // Template-only import was preserved (not tree-shaken) → child rendered.
    expect(result.body).toContain('PROBE_RENDERED');
  });
});
