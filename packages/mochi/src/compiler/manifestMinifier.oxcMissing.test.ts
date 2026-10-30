import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/log';

// A `--omit=dev` install: the package resolves to nothing usable. Per-file process isolation keeps this mock local.
mock.module('oxc-minify', () => ({}));

const { ComponentRegistry } = await import('./ComponentRegistry');

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'debug-bar-bundles');
const PAGE_A = path.join(FIXTURE_DIR, 'PageA.svelte');
const PAGE_B = path.join(FIXTURE_DIR, 'PageB.svelte');

let outDir: string;
let savedEnv: string | undefined;

describe('manifest miss on an oxc build without oxc-minify installed', () => {
  beforeAll(() => {
    savedEnv = process.env.MOCHI_MINIFIER;
    delete process.env.MOCHI_MINIFIER;
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-manifest-oxc-missing-'));
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.MOCHI_MINIFIER = savedEnv;
    }
    rmSync(outDir, { recursive: true, force: true });
  });

  test("rebuilds the client bundle with Bun's minifier and warns once", async () => {
    // Built with Bun since oxc can't load here, then labelled as an oxc build to stand in for one made on a dev machine.
    const builder = new ComponentRegistry({ development: false, debugBar: false, outDir });
    await builder.compileAll([PAGE_A]);
    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify({ ...builder.toManifest(), minifier: 'oxc' }));

    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const restored = await ComponentRegistry.fromManifest(manifestPath, false);
      expect(restored.minifier).toBe('oxc');
      await restored.compileAll([PAGE_B]);
      await restored.compileAll([PAGE_B], { force: true });

      const fallbacks = warn.mock.calls.filter((c) => String(c[0]).includes("oxc-minify can't be loaded at runtime"));
      expect(fallbacks).toHaveLength(1);
      const jsUrls = [...restored.getClientFiles().keys()].filter((url) => url.endsWith('.js'));
      expect(jsUrls.length).toBeGreaterThan(0);
      expect(jsUrls.filter((url) => /-o[0-9a-f]{8}\.js$/.test(url))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
