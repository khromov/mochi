import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { mochiEvents } from '../events';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'client-bundle-chunks');
const PAGE_A = path.join(FIXTURE_DIR, 'PageA.svelte');
const PAGE_B = path.join(FIXTURE_DIR, 'PageB.svelte');

// Both vendor modules export a colliding `parse`, so a formulation that merged the group's exports into one surface
// would resolve the wrong one — the failure this fixture exists to catch.
const intoVendor = (id: string) => (id.includes('client-bundle-chunks/vendor') ? 'vendor' : null);

let outDir: string;
let bundleEvents: number;
const onBundle = () => {
  bundleEvents += 1;
};

beforeEach(() => {
  // src/compiler/ is two levels below the package root, and a Mochi outDir must stay inside the project tree.
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-chunk-bundle-'));
  bundleEvents = 0;
  mochiEvents.on('client-bundle:complete', onBundle);
});

afterEach(() => {
  mochiEvents.off('client-bundle:complete', onBundle);
  rmSync(outDir, { recursive: true, force: true });
});

const outputs = (registry: ComponentRegistry) => registry.getClientStats()?.outputs ?? [];
const inputPaths = (o: { inputs: { path: string }[] }) => o.inputs.map((i) => i.path);
/** Inputs that are real source files, dropping the generated view modules the mechanism inserts. */
const realInputs = (o: { inputs: { path: string }[] }) => inputPaths(o).filter((p) => !p.includes('mochi-chunk:'));

describe('clientBundle.chunks', () => {
  test('collapses the named modules into one shared chunk, out of the island entries', async () => {
    const registry = new ComponentRegistry({ development: false, outDir, clientBundle: { chunks: intoVendor } });
    await registry.compileAll([PAGE_A, PAGE_B]);

    const named = outputs(registry).filter((o) => o.chunkName === 'vendor');
    expect(named).toHaveLength(1);

    const chunkInputs = realInputs(named[0]!).join('\n');
    expect(chunkInputs).toContain('vendorOne.ts');
    expect(chunkInputs).toContain('vendorTwo.ts');

    // The point of the feature: the real vendor modules left the per-island entries. Each entry keeps a generated
    // view module named after its source, which is a re-export shim and not the module itself.
    for (const o of outputs(registry)) {
      if (o.chunkName === 'vendor') {
        continue;
      }
      expect(realInputs(o).join('\n')).not.toContain('vendorOne.ts');
      expect(realInputs(o).join('\n')).not.toContain('vendorTwo.ts');
    }
  });

  test('every emitted output is actually served', async () => {
    const registry = new ComponentRegistry({ development: false, outDir, clientBundle: { chunks: intoVendor } });
    await registry.compileAll([PAGE_A, PAGE_B]);

    const files = registry.getClientFiles();
    for (const o of outputs(registry)) {
      expect(files.has(`${registry.assetPrefix}/client/${o.name}`)).toBe(true);
    }
  });

  test('islands still resolve to their own entry bundles', async () => {
    const registry = new ComponentRegistry({ development: false, outDir, clientBundle: { chunks: intoVendor } });
    await registry.compileAll([PAGE_A, PAGE_B]);

    expect(registry.getIslandBootstrapUrl()).not.toBeNull();
    const urls = outputs(registry)
      .filter((o) => o.chunkName === undefined)
      .map((o) => o.name);
    expect(urls.length).toBeGreaterThan(0);
  });

  // The colliding `parse` must not be flattened: each island keeps its own binding.
  test('a chunk carrying two modules with the same export name still builds', async () => {
    const registry = new ComponentRegistry({ development: false, outDir, clientBundle: { chunks: intoVendor } });
    await expect(registry.compileAll([PAGE_A, PAGE_B])).resolves.toBeUndefined();
    expect(registry.getErrors()).toHaveLength(0);
  });

  test('a classifier that matches nothing leaves the bundle exactly as it was', async () => {
    const plain = new ComponentRegistry({ development: false, outDir });
    await plain.compileAll([PAGE_A, PAGE_B]);
    const before = outputs(plain)
      .map((o) => `${o.name}:${o.size}`)
      .sort();

    const other = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-chunk-bundle-'));
    try {
      const withOpt = new ComponentRegistry({ development: false, outDir: other, clientBundle: { chunks: () => null } });
      await withOpt.compileAll([PAGE_A, PAGE_B]);
      const after = outputs(withOpt)
        .map((o) => `${o.name}:${o.size}`)
        .sort();
      expect(after).toEqual(before);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test('an invalid chunk name fails the build and names the offender', async () => {
    const registry = new ComponentRegistry({ development: false, outDir, clientBundle: { chunks: (id) => (id.includes('vendorOne') ? '../escape' : null) } });
    await expect(registry.compileAll([PAGE_A])).rejects.toThrow(/Invalid chunk name .*vendorOne/s);
  });

  test('a malformed option is rejected at construction, before any build runs', () => {
    expect(() => new ComponentRegistry({ development: false, outDir, clientBundle: { nope: true } as never })).toThrow(/Unknown clientBundle option "nope"/);
  });
});

describe('clientBundle in development', () => {
  // Production-only is the guarantee the whole design rests on: dev must pay nothing and behave identically.
  test('ignores chunks entirely — no discovery pass, no named chunk', async () => {
    const registry = new ComponentRegistry({ development: true, outDir, debugBar: false, clientBundle: { chunks: intoVendor } });
    await registry.compileAll([PAGE_A, PAGE_B]);

    expect(bundleEvents).toBe(1);
    expect(outputs(registry).some((o) => o.chunkName !== undefined)).toBe(false);
    expect(registry.getSkippedChunkModules()).toHaveLength(0);
  });
});
