import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { resetPrerenderEvaluationCache } from './prerenderModules';

// outDir must live inside the project tree: the SSR chunks it emits resolve their framework imports through the
// project's node_modules chain. Depth is '..','..' from src/compiler/.
let outDir: string;
let app: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-prerender-compile-'));
  app = path.join(outDir, 'app');
  // A top-level side effect the bundler cannot tree-shake on its own, so the marker reaches the chunk unless the module was replaced.
  await Bun.write(path.join(app, 'buildOnly.ts'), `globalThis.__mochi_build_only_marker__ = 'SENTINEL_SIDE_EFFECT';\nexport const greeting = () => 'from build time';\n`);
  await Bun.write(
    path.join(app, 'value.prerender.ts'),
    `import { greeting } from './buildOnly.ts';\nexport const text = await Promise.resolve(greeting());\nexport default { when: new Date(0) };\n`,
  );
  await Bun.write(
    path.join(app, 'Page.svelte'),
    `<script>\n  import { text } from './value.prerender.ts';\n  import meta from './value.prerender.ts';\n</${'script'}>\n<p>{text} at {meta.when.toISOString()}</p>\n`,
  );
});

afterAll(() => {
  resetPrerenderEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

async function ssrChunks(): Promise<string> {
  const artifact = path.join(outDir, 'svelte-compile');
  let ssr = '';
  for await (const name of new Bun.Glob('*.js').scan(artifact)) {
    ssr += await Bun.file(path.join(artifact, name)).text();
  }
  return ssr;
}

describe('a *.prerender.ts module through a real compile', () => {
  test('bakes the exports into the SSR chunk and leaves the producing module out', async () => {
    const registry = new ComponentRegistry({ development: false, outDir });
    await registry.compileAll([path.join(app, 'Page.svelte')]);
    expect(registry.getErrors()).toEqual([]);
    const ssr = await ssrChunks();
    expect(ssr).toContain('from build time');
    // The point of the whole feature: the build-time dependency is gone, side effect and all.
    expect(ssr).not.toContain('SENTINEL_SIDE_EFFECT');
    expect(registry.getPrerenderModules()).toEqual([path.join(app, 'value.prerender.ts')]);
  }, 60_000);

  test('renders the inlined values, rich types included', async () => {
    const registry = new ComponentRegistry({ development: false, outDir });
    await registry.compileAll([path.join(app, 'Page.svelte')]);
    const { body } = await registry.renderComponent(path.join(app, 'Page.svelte'), {});
    expect(body).toContain('from build time at 1970-01-01T00:00:00.000Z');
  }, 60_000);

  test('an evaluation error surfaces as a compile error naming the module', async () => {
    await Bun.write(path.join(app, 'broken.prerender.ts'), `export const fn = () => 1;\n`);
    await Bun.write(path.join(app, 'Broken.svelte'), `<script>\n  import { fn } from './broken.prerender.ts';\n</${'script'}>\n<p>{fn}</p>\n`);
    const registry = new ComponentRegistry({ development: false, outDir });
    const failure = await registry.compileAll([path.join(app, 'Broken.svelte')]).then(
      () => '',
      (e: Error) => e.message,
    );
    expect(failure).toContain('broken.prerender.ts exports "fn", which cannot be inlined');
    expect(failure).not.toContain('\\');
  }, 60_000);
});
