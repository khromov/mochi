import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { resetPrerenderEvaluationCache } from './prerenderModules';

let outDir: string;
let app: string;
let dep: string;
let page: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-prerender-freshness-'));
  app = path.join(outDir, 'app');
  dep = path.join(app, 'dep.ts');
  page = path.join(app, 'Page.svelte');
  await Bun.write(dep, `export const version = 'v1';\n`);
  await Bun.write(path.join(app, 'value.prerender.ts'), `import { version } from './dep.ts';\nexport const text = version;\n`);
  await Bun.write(page, `<script>\n  import { text } from './value.prerender.ts';\n</${'script'}>\n<p>{text}</p>\n`);
});

afterAll(() => {
  resetPrerenderEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

describe('dev rebuilds re-evaluate a prerendered module', () => {
  test('an edit to a file the module imports reaches the page through recompileChanged', async () => {
    const registry = new ComponentRegistry({ development: true, outDir });
    await registry.compileAll([page]);
    expect((await registry.renderComponent(page, {})).body).toContain('v1');

    await Bun.write(dep, `export const version = 'v2';\n`);
    // What the watcher does at the head of every rebuild task.
    resetPrerenderEvaluationCache();
    // dep.ts is not in the bundler's graph — the module that imported it was replaced — so this only works through the recorded inputs.
    const { pages } = await registry.recompileChanged(dep);
    expect(pages).toEqual(new Set([page]));
    expect((await registry.renderComponent(page, {})).body).toContain('v2');
  }, 60_000);

  test('a structural change rebuilds the prerendered modules alongside the changed file in one batch', async () => {
    const registry = new ComponentRegistry({ development: true, outDir });
    const other = path.join(app, 'Other.svelte');
    await Bun.write(other, `<p>other</p>\n`);
    await registry.compileAll([page, other]);
    expect((await registry.renderComponent(page, {})).body).toContain('v2');

    await Bun.write(dep, `export const version = 'v3';\n`);
    resetPrerenderEvaluationCache();
    // The changed file affects only Other.svelte; the flag brings the module's page into the same rebuild.
    const { pages } = await registry.recompileChanged(other, { withPrerenderModules: true });
    expect(pages).toEqual(new Set([page, other]));
    expect((await registry.renderComponent(page, {})).body).toContain('v3');
  }, 60_000);
});
