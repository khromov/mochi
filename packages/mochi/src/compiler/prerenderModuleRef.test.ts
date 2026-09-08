import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { resetPrerenderEvaluationCache } from './prerenderModules';

let outDir: string;
let app: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-prerender-moduleref-'));
  app = path.join(outDir, 'app');
  await Bun.write(path.join(app, 'Card.svelte'), `<p class="card">card markup</p>\n`);
  await Bun.write(
    path.join(app, 'cards.prerender.ts'),
    `import { moduleRef } from 'mochi-framework';\nexport const cards = { card: moduleRef('./Card.svelte'), again: moduleRef('./Card.svelte') };\n`,
  );
  await Bun.write(
    path.join(app, 'Page.svelte'),
    `<script>\n  import { cards } from './cards.prerender.ts';\n  const Card = cards.card;\n  const Again = cards.again;\n</${'script'}>\n<Card />\n<Again />\n`,
  );
});

afterAll(() => {
  resetPrerenderEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

describe('moduleRef() in a *.prerender.ts module', () => {
  test('becomes a real import the page can render as a component', async () => {
    const registry = new ComponentRegistry({ development: false, outDir });
    await registry.compileAll([path.join(app, 'Page.svelte')]);
    expect(registry.getErrors()).toEqual([]);
    const { body } = await registry.renderComponent(path.join(app, 'Page.svelte'), {});
    expect(body.match(/card markup/g)).toHaveLength(2);
  }, 60_000);
});
