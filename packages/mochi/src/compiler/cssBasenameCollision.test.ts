import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'css-basename-collision');
const CARD_A = path.join(FIXTURE_DIR, 'a', 'Card.svelte');
const CARD_B = path.join(FIXTURE_DIR, 'b', 'Card.svelte');

// Regression: the batched CSS minify writes every component's raw CSS to disk
// before one shared Bun.build. Two components sharing a basename (a/Card.svelte,
// b/Card.svelte) must not collide on one intermediate file — pre-fix that would
// silently serve one component's styles for both.
describe('scoped CSS for components sharing a basename', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-css-basename-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compileAll([CARD_A, CARD_B]);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('each component gets its own CSS URL', () => {
    const urlA = registry.getComponentCssUrl(CARD_A);
    const urlB = registry.getComponentCssUrl(CARD_B);
    expect(urlA).toBeDefined();
    expect(urlB).toBeDefined();
    expect(urlA).not.toBe(urlB);
  });

  test('each URL serves that component’s own styles', () => {
    const cssA = registry.getClientFile(registry.getComponentCssUrl(CARD_A)!);
    const cssB = registry.getClientFile(registry.getComponentCssUrl(CARD_B)!);
    expect(cssA).toContain('#a1b2c3');
    expect(cssA).not.toContain('#d4e5f6');
    expect(cssB).toContain('#d4e5f6');
    expect(cssB).not.toContain('#a1b2c3');
  });
});
