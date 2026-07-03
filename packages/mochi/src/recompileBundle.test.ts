// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { mochiEvents } from './events';
import type { HydratableComponent } from './svelteAstPreprocess';

interface RegistryInternals {
  compiledComponents: Map<
    string,
    {
      module: { default: unknown };
      cssComponents: Set<string>;
      hydratables: HydratableComponent[];
    }
  >;
  hydratableComponents: HydratableComponent[];
  entryDeps: Map<string, Set<string>>;
  clientBundleCallCount: number;
}

// Per-test seeded dep graph. Tests populate this before compiling, and the
// stubbed compileAll() copies the entry into entryDeps so recompileChanged()
// has something to walk.
let seededDeps: Map<string, Set<string>>;

describe('recompile* batches into one compileAll + one buildClientBundle per cycle', () => {
  let outDir: string;
  let registry: ComponentRegistry;
  let bundleCalls: number;
  let compileAllCalls: number;
  let lastCompileAllArgs: string[];

  beforeEach(() => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-recompile-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    bundleCalls = 0;
    compileAllCalls = 0;
    lastCompileAllArgs = [];
    seededDeps = new Map();

    const internals = registry as unknown as RegistryInternals;

    // Stub the real Svelte SSR compileAll. Mirrors the contract: filter cached
    // entries unless forced, otherwise populate caches for each filename and
    // call buildClientBundle once if any hydratables were registered. Also
    // copies each entry's seededDeps into entryDeps so recompileChanged() can
    // walk dep graphs.
    (
      registry as unknown as {
        compileAll: (filenames: string[], opts?: { force?: boolean }) => Promise<void>;
      }
    ).compileAll = async function (filenames: string[], opts: { force?: boolean } = {}): Promise<void> {
      compileAllCalls += 1;
      const todo = opts.force ? [...new Set(filenames)] : [...new Set(filenames)].filter((f) => !internals.compiledComponents.has(f));
      lastCompileAllArgs = todo;
      if (todo.length === 0) {
        return;
      }
      const newHydratables: HydratableComponent[] = [];
      for (const filename of todo) {
        const stub: HydratableComponent = {
          name: `Stub_${path.basename(filename, '.svelte')}`,
          displayName: path.basename(filename, '.svelte'),
          resolvedPath: filename,
        };
        internals.compiledComponents.set(filename, {
          module: { default: () => '' },
          cssComponents: new Set(),
          hydratables: [stub],
        });
        newHydratables.push(stub);
        const seeded = seededDeps.get(filename);
        // Mirror the real compileAll(): record the entry's own path in its
        // dep set so changedPath===entry hits both code paths in
        // recompileChanged(). The real method stores path.resolve'd inputs, and
        // recompileChanged() resolves its query, so resolve here too — otherwise
        // on Windows path.resolve('/fake/x') → 'C:\fake\x' never matches a raw
        // '/fake/x' seed.
        internals.entryDeps.set(filename, new Set([path.resolve(filename), ...[...(seeded ?? [])].map((d) => path.resolve(d))]));
      }
      internals.hydratableComponents.push(...newHydratables);
      if (newHydratables.length > 0) {
        await (registry as unknown as { buildClientBundle: () => Promise<void> }).buildClientBundle();
      }
    };

    // Stub the client bundle so the test doesn't run Bun.build (a 2nd Bun.build
    // would trip the same EISDIR bug). Bumps the counter the real method does
    // and emits the same event subscribers would see.
    (registry as unknown as { buildClientBundle: () => Promise<void> }).buildClientBundle = async function (): Promise<void> {
      bundleCalls += 1;
      internals.clientBundleCallCount += 1;
      mochiEvents.emit('client-bundle:complete', { entryCount: 0, outputBytes: 0, durationMs: 0 });
    };
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('seeds the registry via one batched compileAll + bundles once', async () => {
    await registry.compileAll(['/fake/PageA.svelte', '/fake/PageB.svelte']);
    expect(compileAllCalls).toBe(1);
    expect(bundleCalls).toBe(1); // single trailing buildClientBundle for the cohort
    expect(registry.getPageCount()).toBe(2);
  });

  test('recompileAll re-runs the entire cohort in one compileAll and bundles once', async () => {
    await registry.compileAll(['/fake/PageA.svelte', '/fake/PageB.svelte']);
    expect(registry.getPageCount()).toBe(2);

    bundleCalls = 0;
    compileAllCalls = 0;
    lastCompileAllArgs = [];

    let observedBundleEvents = 0;
    const handler = () => {
      observedBundleEvents += 1;
    };
    mochiEvents.on('client-bundle:complete', handler);

    try {
      const summary = await registry.recompileAll();
      expect(summary.pages.size).toBe(2);
      expect(summary.clientBundleCount).toBe(1);
      expect(compileAllCalls).toBe(1); // one batched build, not N
      expect(bundleCalls).toBe(1); // smoking gun: would have been N without batching
      expect(observedBundleEvents).toBe(1);
      expect(new Set(lastCompileAllArgs)).toEqual(new Set(['/fake/PageA.svelte', '/fake/PageB.svelte']));
    } finally {
      mochiEvents.off('client-bundle:complete', handler);
    }
  });

  test('emits no client-bundle event when no hydratable pages were registered', async () => {
    let observedBundleEvents = 0;
    const handler = () => {
      observedBundleEvents += 1;
    };
    mochiEvents.on('client-bundle:complete', handler);
    try {
      const summary = await registry.recompileAll();
      expect(summary.pages.size).toBe(0);
      expect(summary.clientBundleCount).toBe(0);
      expect(compileAllCalls).toBe(0); // nothing to rebuild → skip compileAll entirely
      expect(observedBundleEvents).toBe(0);
    } finally {
      mochiEvents.off('client-bundle:complete', handler);
    }
  });

  test('recompileChanged rebuilds only pages whose dep graph contains the changed file', async () => {
    // PageA imports a shared helper; PageB does not.
    const SHARED = '/fake/shared.ts';
    const STANDALONE = '/fake/standalone.ts';
    seededDeps.set('/fake/PageA.svelte', new Set([SHARED]));
    seededDeps.set('/fake/PageB.svelte', new Set([STANDALONE]));
    await registry.compileAll(['/fake/PageA.svelte', '/fake/PageB.svelte']);
    expect(registry.getPageCount()).toBe(2);

    bundleCalls = 0;
    compileAllCalls = 0;
    lastCompileAllArgs = [];

    const summary = await registry.recompileChanged(SHARED);

    expect(summary.pages.size).toBe(1); // only PageA depends on shared.ts
    expect(summary.clientBundleCount).toBe(1);
    expect(compileAllCalls).toBe(1);
    expect(lastCompileAllArgs).toEqual(['/fake/PageA.svelte']);
    expect(bundleCalls).toBe(1);
    expect(registry.getPageCount()).toBe(2); // PageB still cached
  });

  test('recompileChanged for an unknown path is a no-op', async () => {
    seededDeps.set('/fake/PageA.svelte', new Set(['/fake/dep.ts']));
    await registry.compileAll(['/fake/PageA.svelte']);

    bundleCalls = 0;
    compileAllCalls = 0;

    const summary = await registry.recompileChanged('/fake/unrelated.ts');

    expect(summary.pages.size).toBe(0);
    expect(summary.clientBundleCount).toBe(0);
    expect(compileAllCalls).toBe(0); // nothing rebuilt
    expect(bundleCalls).toBe(0); // bundle skipped
  });

  test('recompileChanged on the entry file itself rebuilds just that entry', async () => {
    seededDeps.set('/fake/PageA.svelte', new Set());
    seededDeps.set('/fake/PageB.svelte', new Set());
    await registry.compileAll(['/fake/PageA.svelte', '/fake/PageB.svelte']);

    bundleCalls = 0;
    compileAllCalls = 0;

    const summary = await registry.recompileChanged('/fake/PageA.svelte');

    expect(summary.pages.size).toBe(1);
    expect(compileAllCalls).toBe(1);
    expect(lastCompileAllArgs).toEqual(['/fake/PageA.svelte']);
    expect(bundleCalls).toBe(1);
  });

  // Regression: real callers register pages with relative paths
  // (`Mochi.page('./src/Site.svelte', ...)`), so `compiledComponents` /
  // `entryDeps` are keyed by the relative form. recompileChanged must evict
  // and recompile under the SAME key — otherwise the renderComponent path
  // (which calls compile() with the original relative key on every request)
  // gets a stale cache hit and SSR returns the previous module.
  test('recompileChanged with a relative entry key still evicts and recompiles', async () => {
    const REL = './fake-rel/PageRel.svelte';
    const DEP = path.resolve('./fake-rel/dep.ts');
    seededDeps.set(REL, new Set([DEP]));
    await registry.compileAll([REL]);

    const internals = registry as unknown as RegistryInternals;
    const beforeEntry = internals.compiledComponents.get(REL);
    const beforeSize = internals.compiledComponents.size;
    expect(beforeEntry).toBeDefined();

    const summary = await registry.recompileChanged(DEP);

    // Public contract: pages are absolute (matches __mochi_page_entry).
    expect(summary.pages).toEqual(new Set([path.resolve(REL)]));

    // Smoking gun #1: the entry under REL must have been REPLACED, not left
    // stale. Pre-fix, recompileChanged evicted+recompiled under the absolute
    // path, leaving the original REL-keyed module untouched.
    const afterEntry = internals.compiledComponents.get(REL);
    expect(afterEntry).toBeDefined();
    expect(afterEntry).not.toBe(beforeEntry);

    // Smoking gun #2: no duplicate entry under the absolute form. Pre-fix,
    // both REL (stale) and path.resolve(REL) (fresh) would be present.
    expect(internals.compiledComponents.size).toBe(beforeSize);
    if (REL !== path.resolve(REL)) {
      expect(internals.compiledComponents.has(path.resolve(REL))).toBe(false);
    }
  });

  // Race-window regression: pre-fix, recompileChanged deleted the cache entry
  // before `await compile()` ran, leaving a window where renderComponent
  // (which does `compiledComponents.get(filename)!`) saw `undefined` and
  // crashed Svelte's renderer with "component is not a function". The fix is
  // that compileAll(force:true) overwrites in place; the old entry stays
  // valid until the new one swaps it via `set()`.
  test('compiledComponents entry stays defined throughout recompileChanged', async () => {
    seededDeps.set('/fake/PageA.svelte', new Set());
    await registry.compileAll(['/fake/PageA.svelte']);

    const internals = registry as unknown as RegistryInternals;
    const beforeEntry = internals.compiledComponents.get('/fake/PageA.svelte');
    expect(beforeEntry).toBeDefined();

    // Replace the seeded compileAll stub with a gated version so we can
    // observe cache state mid-rebuild.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    (
      registry as unknown as {
        compileAll: (filenames: string[], opts?: { force?: boolean }) => Promise<void>;
      }
    ).compileAll = async function (filenames: string[], opts: { force?: boolean } = {}): Promise<void> {
      const todo = opts.force ? filenames : filenames.filter((f) => !internals.compiledComponents.has(f));
      if (todo.length === 0) {
        return;
      }
      // Yield, hold mid-rebuild, then swap each entry.
      await gate;
      for (const filename of todo) {
        internals.compiledComponents.set(filename, {
          module: { default: () => '' },
          cssComponents: new Set(),
          hydratables: [],
        });
      }
    };

    const rebuild = registry.recompileChanged('/fake/PageA.svelte');
    // Let recompileChanged enter the gated compileAll call.
    await Promise.resolve();
    await Promise.resolve();

    // Pre-fix this would be `undefined` (clearEntry already deleted it).
    expect(internals.compiledComponents.get('/fake/PageA.svelte')).toBeDefined();
    // And it should still be the original module — not yet swapped.
    expect(internals.compiledComponents.get('/fake/PageA.svelte')).toBe(beforeEntry);

    release();
    await rebuild;

    // Post-rebuild: entry replaced by the new module.
    const afterEntry = internals.compiledComponents.get('/fake/PageA.svelte');
    expect(afterEntry).toBeDefined();
    expect(afterEntry).not.toBe(beforeEntry);
  });
});
