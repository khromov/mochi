import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { resetCompiledEvaluationCache } from './compiledModules';

let outDir: string;
let app: string;
let dep: string;
let page: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-compiled-freshness-'));
  app = path.join(outDir, 'app');
  dep = path.join(app, 'dep.ts');
  page = path.join(app, 'Page.svelte');
  await Bun.write(dep, `export const version = 'v1';\n`);
  await Bun.write(path.join(app, 'value.compiled.ts'), `import { version } from './dep.ts';\nexport const text = version;\n`);
  await Bun.write(page, `<script>\n  import { text } from './value.compiled.ts';\n</${'script'}>\n<p>{text}</p>\n`);
});

afterAll(() => {
  resetCompiledEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

describe('dev rebuilds re-evaluate a build-time module', () => {
  test('an edit to a file the module imports reaches the page through recompileChanged', async () => {
    const registry = new ComponentRegistry({ development: true, outDir });
    await registry.compileAll([page]);
    expect((await registry.renderComponent(page, {})).body).toContain('v1');

    await Bun.write(dep, `export const version = 'v2';\n`);
    // What the watcher does at the head of every rebuild task.
    resetCompiledEvaluationCache();
    // dep.ts is not in the bundler's graph — the module that imported it was replaced — so this only works through the recorded inputs.
    const { pages } = await registry.recompileChanged(dep);
    expect(pages).toEqual(new Set([page]));
    expect((await registry.renderComponent(page, {})).body).toContain('v2');
  }, 60_000);
});
