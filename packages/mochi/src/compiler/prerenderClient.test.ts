import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { resetPrerenderEvaluationCache } from './prerenderModules';

let outDir: string;
let app: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-prerender-client-'));
  app = path.join(outDir, 'app');
  await Bun.write(path.join(app, 'buildOnly.ts'), `globalThis.__mochi_build_only_marker__ = 'SENTINEL_SIDE_EFFECT';\nexport const greeting = () => 'hydrated build-time value';\n`);
  await Bun.write(path.join(app, 'value.prerender.ts'), `import { greeting } from './buildOnly.ts';\nexport const text = greeting();\n`);
  await Bun.write(
    path.join(app, 'Counter.svelte'),
    `<script>\n  import { text } from './value.prerender.ts';\n  let n = $state(0);\n</${'script'}>\n<button onclick={() => n++}>{text} {n}</button>\n`,
  );
  await Bun.write(path.join(app, 'Page.svelte'), `<script>\n  import Counter from './Counter.svelte';\n</${'script'}>\n<Counter mochi:hydrate />\n`);
});

afterAll(() => {
  resetPrerenderEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

describe('a *.prerender.ts module inside a hydrated island', () => {
  test('the client bundle carries the literal, not the producing module', async () => {
    const registry = new ComponentRegistry({ development: false, outDir });
    await registry.compileAll([path.join(app, 'Page.svelte')]);
    expect(registry.getErrors()).toEqual([]);
    let client = '';
    for await (const name of new Bun.Glob('**/*.js').scan(path.join(outDir, 'svelte-client'))) {
      client += await Bun.file(path.join(outDir, 'svelte-client', name)).text();
    }
    expect(client).toContain('hydrated build-time value');
    expect(client).not.toContain('SENTINEL_SIDE_EFFECT');
    const { body } = await registry.renderComponent(path.join(app, 'Page.svelte'), {});
    expect(body).toContain('hydrated build-time value');
  }, 60_000);
});
