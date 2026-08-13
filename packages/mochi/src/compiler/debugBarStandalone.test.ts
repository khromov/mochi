import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'debug-bar-bundles');
const PAGE_A = path.join(FIXTURE_DIR, 'PageA.svelte');

let outDir: string;
let registry: ComponentRegistry;

describe('debug bar standalone bundle', () => {
  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-debug-bar-standalone-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compileAll([PAGE_A]);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('compiles production-mode while islands stay dev-mode', () => {
    const url = registry.getDebugBarUrl();
    expect(url).not.toBeNull();
    const contents = registry.getClientFile(url!);
    expect(contents).toBeDefined();

    // Svelte's dev output stamps `Component[FILENAME] = "<abs path>"`; the string survives minification, so its
    // absence is the production-compile marker.
    expect(contents!).not.toContain('debug-bar/MochiDebugBar.svelte');

    const islandFiles = [...registry.getClientFiles().entries()].filter(([k]) => k !== url);
    expect(islandFiles.some(([, v]) => v.includes('debug-bar-bundles/WidgetA.svelte'))).toBe(true);
  });

  test('bundle is self-contained and well under the old dev-mode size', () => {
    const contents = registry.getClientFile(registry.getDebugBarUrl()!)!;
    expect(contents).not.toContain('from"/_mochi/client/chunk-');
    expect(contents.length).toBeLessThan(200_000);
  });

  test('survives a rebuild without rebuilding: same URL, still served', async () => {
    const urlBefore = registry.getDebugBarUrl();
    await registry.recompileAll();
    expect(registry.getDebugBarUrl()).toBe(urlBefore!);
    expect(registry.getClientFile(urlBefore!)).toBeDefined();
  });

  test('is excluded from client bundle stats', () => {
    const url = registry.getDebugBarUrl()!;
    const outputs = registry.getClientStats()?.outputs ?? [];
    expect(outputs.some((o) => url.endsWith(o.name))).toBe(false);
  });
});

describe('debug bar disabled', () => {
  let disabledOutDir: string;

  beforeAll(() => {
    disabledOutDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-debug-bar-disabled-'));
  });

  afterAll(() => {
    rmSync(disabledOutDir, { recursive: true, force: true });
  });

  test('no bundle is built or served', async () => {
    const disabled = new ComponentRegistry({ development: true, outDir: disabledOutDir, debugBar: false });
    await disabled.compileAll([PAGE_A]);
    expect(disabled.getDebugBarUrl()).toBeNull();
    const files = [...disabled.getClientFiles().keys()];
    expect(files.some((k) => k.includes('debugbar-entry'))).toBe(false);
  });
});
