import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import type { MochiManifest } from '../types';

const PAGE_A = path.join(import.meta.dir, '..', '__fixtures__', 'debug-bar-bundles', 'PageA.svelte');

let outDir: string;
let manifest: MochiManifest;
let savedEnv: string | undefined;

async function writeManifest(name: string, m: MochiManifest): Promise<string> {
  const manifestPath = path.join(outDir, name);
  await Bun.write(manifestPath, JSON.stringify(m));
  return manifestPath;
}

describe('manifest minifier', () => {
  beforeAll(async () => {
    savedEnv = process.env.MOCHI_MINIFIER;
    delete process.env.MOCHI_MINIFIER;
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-manifest-minifier-'));
    const registry = new ComponentRegistry({ development: false, debugBar: false, outDir, minifier: 'oxc' });
    await registry.compileAll([PAGE_A]);
    manifest = registry.toManifest();
  });

  afterAll(() => {
    if (savedEnv === undefined) {
      delete process.env.MOCHI_MINIFIER;
    } else {
      process.env.MOCHI_MINIFIER = savedEnv;
    }
    rmSync(outDir, { recursive: true, force: true });
  });

  test('records the minifier the build used', () => {
    expect(manifest.minifier).toBe('oxc');
  });

  test("a restored registry keeps the build's minifier over the serve process's own setting", async () => {
    process.env.MOCHI_MINIFIER = 'bun';
    try {
      const restored = await ComponentRegistry.fromManifest(await writeManifest('manifest.json', manifest), false);
      expect(restored.minifier).toBe('oxc');
    } finally {
      delete process.env.MOCHI_MINIFIER;
    }
  });

  test('an unknown recorded minifier is rejected', async () => {
    const manifestPath = await writeManifest('manifest-bad.json', { ...manifest, minifier: 'terser' as never });
    await expect(ComponentRegistry.fromManifest(manifestPath, false)).rejects.toThrow('Unknown minifier "terser"');
  });
});
