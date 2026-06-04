import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { freshImport, freshImportBundled } from './freshImport';

describe('freshImport', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-freshimport-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('re-imports an edited module without a restart', async () => {
    const file = path.join(dir, 'mod.mjs');
    writeFileSync(file, 'export const value = "FIRST";\n');
    expect((await freshImport(file)).value).toBe('FIRST');

    writeFileSync(file, 'export const value = "SECOND";\n');
    expect((await freshImport(file)).value).toBe('SECOND');
  });
});

describe('freshImportBundled', () => {
  let dir: string;
  let tempDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-freshbundle-'));
    tempDir = path.join(dir, '.mochi');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // The bundle lives in `tempDir`, away from the source's siblings — so a plain copy
  // would fail to resolve `./helper.js`. Bundling inlines it, which is the whole point.
  test('inlines a relative import so the copy resolves from tempDir', async () => {
    writeFileSync(path.join(dir, 'helper.js'), 'export const opts = { compilerOptions: { runes: true } };\n');
    const cfg = path.join(dir, 'svelte.config.js');
    writeFileSync(cfg, "import { opts } from './helper.js';\nexport default opts;\n");

    const mod = await freshImportBundled(cfg, tempDir);
    expect(mod.default).toEqual({ compilerOptions: { runes: true } });
  });

  test('re-imports edited config (and its relative dep) without a restart', async () => {
    const helper = path.join(dir, 'helper.js');
    const cfg = path.join(dir, 'svelte.config.js');
    writeFileSync(cfg, "export { flag } from './helper.js';\n");

    writeFileSync(helper, 'export const flag = "ALPHA";\n');
    expect((await freshImportBundled(cfg, tempDir)).flag).toBe('ALPHA');

    writeFileSync(helper, 'export const flag = "BRAVO";\n');
    expect((await freshImportBundled(cfg, tempDir)).flag).toBe('BRAVO');
  });
});
