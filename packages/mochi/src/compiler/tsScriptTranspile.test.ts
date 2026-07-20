import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PreprocessorGroup } from 'svelte/compiler';
import { ComponentRegistry } from './ComponentRegistry';
import { initExtensions } from '../extensions';
import { requestContext } from '../runtime/requestContext';
import type { MochiRequestContext } from '../runtime/requestContext';
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

// Svelte 5's native TS stripping is incomplete — constructor parameter properties
// (`constructor(private x)`) and enums make `svelte/compiler` throw outright.
// Mochi runs Bun's transpiler over `<script lang="ts">` before compilation, so
// these compile. The fixtures pin every path that transpiler must cover:
// instance scripts, `<script module>` scripts, the client (hydration) bundle,
// and template-only value imports (which Bun must NOT tree-shake away).
describe('<script lang="ts"> is fully transpiled by Bun before compilation', () => {
  let dir: string;
  let registry: ComponentRegistry;
  let page: string;

  const render = () => requestContext.run(makeCtx(), () => registry.renderComponent(page));

  beforeAll(async () => {
    // Under packages/mochi so the fixture's bare `svelte` import resolves.
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ts-strip-'));
    page = path.join(dir, 'Page.svelte');
    writeFileSync(path.join(dir, 'Probe.svelte'), '<span data-testid="probe">PROBE_RENDERED</span>\n');
    writeFileSync(
      path.join(dir, 'Kinds.svelte'),
      `<script module lang="ts">
  enum Kind {
    Answer = 'MODULE_ENUM_OK',
  }
  const chosen: Kind = Kind.Answer;
</script>

<em>{chosen}</em>
`,
    );
    writeFileSync(
      path.join(dir, 'HydroProbe.svelte'),
      `<script lang="ts">
  class Tick {
    constructor(private readonly n: number = 9) {}
    get doubled(): number {
      return this.n * 2;
    }
  }
  const tick = new Tick();
</script>

<strong>HYDRO_{tick.doubled}</strong>
`,
    );
    writeFileSync(
      page,
      `<script lang="ts">
  import Probe from './Probe.svelte';
  import Kinds from './Kinds.svelte';
  import HydroProbe from './HydroProbe.svelte';
  class Box {
    constructor(private value = 41) {}
    get next() { return this.value + 1; }
  }
  const box = new Box();
</script>

<p>{box.next}</p>
<Probe />
<Kinds />
<HydroProbe mochi:hydrate />
{#snippet typed(n: number)}<span>SNIPPET_{n}</span>{/snippet}
{@render typed(7)}
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

  test('template stays in TS mode (typed snippet params) — `lang` is not stripped', async () => {
    // The builtin preprocessor must keep `lang="ts"` on the tag: it also
    // governs the template, which Bun's transpiler never sees.
    const result = await render();
    expect(result.body).toContain('SNIPPET_7');
  });

  test('transpiles <script module lang="ts"> blocks too', async () => {
    const result = await render();
    // Enums require real transformation — native stripping rejects them.
    expect(result.body).toContain('MODULE_ENUM_OK');
  });

  test('hydratable TS components compile through the client-bundle path', async () => {
    // `compile()` in beforeAll already built the client bundle (it would have
    // rejected if the client onLoad path failed to transpile HydroProbe's TS) —
    // assert the island actually made it into the page.
    const result = await render();
    expect(result.body).toContain('<mochi-hydratable-island');
    expect(result.body).toContain('HYDRO_18');
  });
});

// The builtin TS pass runs AFTER user `compile:preprocessors`, so TS that a
// user preprocessor emits is transpiled too. The user hook below only fires on
// a `lang="ts"` block (proving `lang` wasn't dropped yet) and injects an enum
// (which svelte's native stripping rejects) — both orderings' failure modes
// make the render throw.
describe('user preprocessors run before the builtin TS pass', () => {
  let dir: string;
  let registry: ComponentRegistry;
  let page: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ts-order-'));
    page = path.join(dir, 'UserPre.svelte');
    writeFileSync(
      page,
      `<script lang="ts">
  /* INJECT */
</script>

<i>{label}</i>
`,
    );
    const injectTsEnum: PreprocessorGroup = {
      name: 'inject-ts-enum',
      script({ content, attributes }) {
        if (attributes.lang !== 'ts') {
          return;
        }
        return {
          code: content.replace('/* INJECT */', `enum Origin { Label = 'USER_PRE_TS' }\n  const label: Origin = Origin.Label;`),
        };
      },
    };
    initExtensions({
      filters: {
        'compile:preprocessors': (list, { filename }) => (filename.endsWith('UserPre.svelte') ? [...list, injectTsEnum] : list),
      },
    });
    registry = new ComponentRegistry({ development: true, outDir: path.join(dir, '.mochi') });
    await registry.compile(page);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('TS emitted by a user preprocessor is transpiled by the builtin pass', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(page));
    expect(result.body).toContain('USER_PRE_TS');
  });
});

// mdsvex passes `<script lang="ts">` through untouched, so the markdown loader
// applies the same builtin TS pass to its output. The stub compiler returns the
// file's content verbatim, standing in for mdsvex-emitted svelte source.
describe('markdown (.md/.svx) output gets the builtin TS pass', () => {
  let dir: string;
  let registry: ComponentRegistry;
  let page: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ts-md-'));
    page = path.join(dir, 'Doc.md');
    writeFileSync(
      page,
      `<script lang="ts">
  enum Doc {
    Marker = 'MD_ENUM_OK',
  }
  const marker: Doc = Doc.Marker;
</script>

<p>{marker}</p>
`,
    );
    registry = new ComponentRegistry({
      development: true,
      outDir: path.join(dir, '.mochi'),
      markdown: { compile: async (source) => ({ code: source }) },
    });
    await registry.compile(page);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('a TS enum inside markdown-emitted svelte compiles and renders', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(page));
    expect(result.body).toContain('MD_ENUM_OK');
  });
});
