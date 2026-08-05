import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { mochiEvents } from '../events';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'defer-bundle');
const PAGE_A = path.join(FIXTURE_DIR, 'PageA.svelte');
const PAGE_B = path.join(FIXTURE_DIR, 'PageB.svelte');

// The CLI build compiles pages and server islands in two compileAll passes;
// deferClientBundle + one trailing finalizeClientBundle keeps that to a single
// client bundle instead of one per pass.
describe('compileAll({ deferClientBundle }) + finalizeClientBundle', () => {
  let outDir: string;
  let registry: ComponentRegistry;
  let bundleEvents: number;
  const onBundle = () => {
    bundleEvents += 1;
  };

  beforeEach(() => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-defer-bundle-'));
    registry = new ComponentRegistry({ development: true, outDir });
    bundleEvents = 0;
    mochiEvents.on('client-bundle:complete', onBundle);
  });

  afterEach(() => {
    mochiEvents.off('client-bundle:complete', onBundle);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('two deferred passes bundle exactly once, at finalize', async () => {
    await registry.compileAll([PAGE_A], { deferClientBundle: true });
    expect(bundleEvents).toBe(0);

    await registry.compileAll([PAGE_B], { deferClientBundle: true });
    expect(bundleEvents).toBe(0);

    await registry.finalizeClientBundle();
    expect(bundleEvents).toBe(1);
    // The single bundle covers hydratables from BOTH passes.
    expect(registry.getIslandBootstrapUrl()).not.toBeNull();
    const stats = registry.getClientStats();
    const entryNames = (stats?.outputs ?? []).map((o) => o.name);
    expect(entryNames.filter((n) => n.includes('WidgetA'))).toHaveLength(1);
    expect(entryNames.filter((n) => n.includes('WidgetB'))).toHaveLength(1);
  });

  test('finalize with no hydratables is a no-op', async () => {
    await registry.finalizeClientBundle();
    expect(bundleEvents).toBe(0);
  });

  test('without the flag compileAll still bundles per pass (dev-path default)', async () => {
    await registry.compileAll([PAGE_A]);
    expect(bundleEvents).toBe(1);
  });
});
