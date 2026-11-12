import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';

const FIXTURES = path.join(import.meta.dir, '..', '__fixtures__', 'hydratable-island');
const PAGE = path.join(FIXTURES, 'Page.svelte');
const CLOBBER_PAGE = path.join(FIXTURES, 'ClobberPage.svelte');

// `bun test` sets NODE_ENV=test, which puts Svelte's server runtime in DEV mode — the mode where a repeated
// hydratable() key re-runs its fallback to check for clobbering.
describe('hydratable() key shared between a page and a mochi:hydrate island', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-hydratable-island-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(PAGE);
    await registry.compile(CLOBBER_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the island reuses the page value during SSR instead of failing on its throwing fallback', async () => {
    const result = await registry.renderComponent(PAGE);

    expect(result.body).toContain('island-from-page-42');
    expect(result.body).not.toContain('island hydratable fallback ran');
    expect(result.body).not.toContain('mochi-island-failure');
    expect(result.head).toContain('mochi-test:shared');
  });

  test("Svelte's clobbering check still rejects a fallback that returns a different value", async () => {
    await expect(registry.renderComponent(CLOBBER_PAGE)).rejects.toThrow('hydratable_clobbering');
  });
});
