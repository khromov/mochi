import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { resetCompiledEvaluationCache } from './compiledTwin';

// outDir must live inside the project tree: the SSR chunks it emits resolve their framework imports through the
// project's node_modules chain. Depth is '..','..' from src/compiler/.
let outDir: string;
let app: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-compiled-compile-'));
  app = path.join(outDir, 'app');
  // A module with a top-level side effect, so the bundler cannot tree-shake it away on its own. If the macro did not
  // prune the import, this marker would appear in the emitted chunk.
  await Bun.write(path.join(app, 'buildOnly.ts'), `globalThis.__mochi_build_only_marker__ = 'SENTINEL_SIDE_EFFECT';\nexport const greeting = () => 'from build time';\n`);
  await Bun.write(
    path.join(app, 'Page.svelte'),
    `<script>\n  import { compiled } from 'mochi-framework';\n  import { greeting } from './buildOnly.ts';\n  const text = await compiled(() => greeting());\n</${'script'}>\n<p>{text}</p>\n`,
  );
});

afterAll(() => {
  resetCompiledEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

async function compilePage(file: string): Promise<{ ssr: string; registry: ComponentRegistry }> {
  const registry = new ComponentRegistry({ development: false, outDir });
  await registry.compileAll([file]);
  expect(registry.getErrors()).toEqual([]);
  const artifact = path.join(outDir, 'svelte-compile');
  const glob = new Bun.Glob('*.server.js');
  let ssr = '';
  for await (const name of glob.scan(artifact)) {
    ssr += await Bun.file(path.join(artifact, name)).text();
  }
  return { ssr, registry };
}

describe('compiled() through a real compile', () => {
  test('bakes the value into the SSR chunk and leaves the producing module out', async () => {
    const { ssr, registry } = await compilePage(path.join(app, 'Page.svelte'));
    expect(ssr).toContain('from build time');
    // The point of the whole feature: the build-time dependency is gone, side effect and all.
    expect(ssr).not.toContain('SENTINEL_SIDE_EFFECT');
    expect(registry.getCompiledUsage()).toHaveLength(1);
    expect(registry.getCompiledUsage()[0]!.count).toBe(1);
  }, 60_000);

  test('renders the inlined value', async () => {
    const registry = new ComponentRegistry({ development: false, outDir });
    await registry.compileAll([path.join(app, 'Page.svelte')]);
    const { body } = await registry.renderComponent(path.join(app, 'Page.svelte'), {});
    expect(body).toContain('from build time');
  }, 60_000);
});
