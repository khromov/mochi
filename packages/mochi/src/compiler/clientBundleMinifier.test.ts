import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'debug-bar-bundles');
const PAGE_A = path.join(FIXTURE_DIR, 'PageA.svelte');

function islandJs(registry: ComponentRegistry): [string, string][] {
  return [...registry.getClientFiles().entries()].filter(([url]) => url.endsWith('.js') && url !== registry.getDebugBarUrl());
}

function totalBytes(files: [string, string][]): number {
  return files.reduce((sum, [, code]) => sum + Buffer.byteLength(code), 0);
}

let bunOutDir: string;
let oxcOutDir: string;
let bunRegistry: ComponentRegistry;
let oxcRegistry: ComponentRegistry;

let savedEnv: string | undefined;

describe('minifier option', () => {
  beforeAll(async () => {
    // This file compares the two modes against each other, so it has to pick them itself. `MOCHI_MINIFIER` wins over
    // the constructor option by design, and the suite is also run with it set to `oxc` — which would otherwise make
    // the "bun" registry an oxc one and the comparison vacuously equal.
    savedEnv = process.env.MOCHI_MINIFIER;
    delete process.env.MOCHI_MINIFIER;
    bunOutDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-minifier-bun-'));
    oxcOutDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-minifier-oxc-'));
    bunRegistry = new ComponentRegistry({ development: false, debugBar: false, outDir: bunOutDir });
    oxcRegistry = new ComponentRegistry({ development: false, debugBar: false, outDir: oxcOutDir, minifier: 'oxc' });
    await bunRegistry.compileAll([PAGE_A]);
    await oxcRegistry.compileAll([PAGE_A]);
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.MOCHI_MINIFIER = savedEnv;
    }
    rmSync(bunOutDir, { recursive: true, force: true });
    rmSync(oxcOutDir, { recursive: true, force: true });
  });

  test("defaults to 'bun'", () => {
    expect(new ComponentRegistry().minifier).toBe('bun');
    expect(bunRegistry.minifier).toBe('bun');
  });

  test('the two modes emit the same chunk set', () => {
    const names = (r: ComponentRegistry) =>
      islandJs(r)
        .map(([url]) => path.basename(url))
        .sort();
    expect(names(oxcRegistry)).toEqual(names(bunRegistry));
  });

  test("'oxc' ships strictly less JS than the Bun baseline", () => {
    const baseline = totalBytes(islandJs(bunRegistry));
    const oxc = totalBytes(islandJs(oxcRegistry));

    expect(oxc).toBeLessThan(baseline);
  });

  test("'oxc' rewrites the files on disk too, which is what a prebuilt manifest boot reads back", () => {
    for (const [url, served] of islandJs(oxcRegistry)) {
      const onDisk = readFileSync(path.join(oxcOutDir, 'svelte-client', path.basename(url)), 'utf8');
      expect(onDisk).toBe(served);
    }
  });

  test('client stats report the bytes actually emitted, not the pre-oxc metafile figures', () => {
    const outputs = oxcRegistry.getClientStats()?.outputs ?? [];
    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      const served = oxcRegistry.getClientFile(`/_mochi/client/${output.name}`);
      expect(output.size).toBe(Buffer.byteLength(served!));
    }
  });

  test('the island bundle still hydrates: the bootstrap and the island entry survive', () => {
    expect(oxcRegistry.getIslandBootstrapUrl()).not.toBeNull();
    // Splitting can hoist the custom-element registration into a shared chunk, so look across the whole bundle.
    expect(islandJs(oxcRegistry).some(([, code]) => code.includes('customElements'))).toBe(true);
    // Every chunk an entry imports must exist under the same name, or the browser 404s mid-hydration.
    const onDisk = new Set(readdirSync(path.join(oxcOutDir, 'svelte-client')));
    for (const [, code] of islandJs(oxcRegistry)) {
      for (const [, spec] of code.matchAll(/from"\/_mochi\/client\/([\w.-]+)"/g)) {
        expect(onDisk.has(spec!)).toBe(true);
      }
    }
  });
});
