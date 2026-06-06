import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'svelte-shaker-mono');
const ROOT = path.join(FIXTURE_DIR, 'Root.svelte');

// End-to-end proof that L2 wiring works through the real Bun pipeline: the
// virtual variant resolves via the plugin's onResolve, compiles via the
// `.svelte` onLoad, and Bun tree-shakes the now-unreferenced Heavy module out
// of the SSR bundle.
describe('L2 monomorphization through compileAll', () => {
  const outDirs: string[] = [];

  afterAll(() => {
    for (const d of outDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  async function compileWith(mono: boolean): Promise<string> {
    const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-mono-test-'));
    outDirs.push(outDir);
    const registry = new ComponentRegistry({
      development: false,
      outDir,
      optimizeWithSvelteShaker: mono ? { mono: true } : true,
    });
    await registry.prepareShake(FIXTURE_DIR);
    await registry.compileAll([ROOT]);
    expect(registry.getErrors()).toEqual([]);
    // Concatenate every emitted SSR module/chunk so we catch Heavy wherever it lands.
    const compileDir = path.join(outDir, 'svelte-compile');
    return readdirSync(compileDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(path.join(compileDir, f), 'utf8'))
      .join('\n');
  }

  test('drops the Heavy module from the SSR bundle when mono is on', async () => {
    const bundle = await compileWith(true);
    expect(bundle).not.toContain('HEAVY_MARKER');
  });

  test('keeps Heavy without mono (L1 cannot prove a&&b is never both 1)', async () => {
    const bundle = await compileWith(false);
    expect(bundle).toContain('HEAVY_MARKER');
  });
});
