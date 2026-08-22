// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { mochiEvents } from '../events';
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

// Fake entrypoints that never touch disk. Resolved because every registry key
// is: on Windows path.resolve('/fake/x') is 'C:\\fake\\x', which a raw literal
// would never match.
const PAGE_A = path.resolve('/fake/PageA.svelte');
const PAGE_B = path.resolve('/fake/PageB.svelte');

describe('recompile* batches into one compileAll + one buildClientBundle per cycle', () => {
  let outDir: string;
  let registry: ComponentRegistry;
  let bundleCalls: number;
  let compileAllCalls: number;
  let lastCompileAllArgs: string[];

  beforeEach(() => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-recompile-test-'));
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
      // Mirror the real compileAll(): every source key is resolved on the way
      // in, so a relative registration and its absolute form are one entry.
      const resolved = [...new Set(filenames.map((f) => path.resolve(f)))];
      const todo = opts.force ? resolved : resolved.filter((f) => !internals.compiledComponents.has(f));
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
          exportName: 'default',
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

    // Stub the client bundle: the fake `/fake/*.svelte` entrypoints this test
    // seeds could never survive a real Bun.build, and the stub doubles as the
    // bundle-call counter. Bumps the counter the real method does and emits
    // the same event subscribers would see.
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
    await registry.compileAll([PAGE_A, PAGE_B]);
    expect(compileAllCalls).toBe(1);
    expect(bundleCalls).toBe(1); // single trailing buildClientBundle for the cohort
    expect(registry.getPageCount()).toBe(2); // stub-derived sanity precondition, not a real-compile claim
  });

  test('recompileAll re-runs the entire cohort in one compileAll and bundles once', async () => {
    await registry.compileAll([PAGE_A, PAGE_B]);
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
      expect(new Set(lastCompileAllArgs)).toEqual(new Set([PAGE_A, PAGE_B]));
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
    seededDeps.set(PAGE_A, new Set([SHARED]));
    seededDeps.set(PAGE_B, new Set([STANDALONE]));
    await registry.compileAll([PAGE_A, PAGE_B]);
    expect(registry.getPageCount()).toBe(2);

    bundleCalls = 0;
    compileAllCalls = 0;
    lastCompileAllArgs = [];

    const summary = await registry.recompileChanged(SHARED);

    expect(summary.pages.size).toBe(1); // only PageA depends on shared.ts
    expect(summary.clientBundleCount).toBe(1);
    expect(compileAllCalls).toBe(1);
    expect(lastCompileAllArgs).toEqual([PAGE_A]);
    expect(bundleCalls).toBe(1);
    expect(registry.getPageCount()).toBe(2); // PageB still cached
  });

  test('recompileChanged for an unknown path is a no-op', async () => {
    seededDeps.set(PAGE_A, new Set(['/fake/dep.ts']));
    await registry.compileAll([PAGE_A]);

    bundleCalls = 0;
    compileAllCalls = 0;

    const summary = await registry.recompileChanged('/fake/unrelated.ts');

    expect(summary.pages.size).toBe(0);
    expect(summary.clientBundleCount).toBe(0);
    expect(compileAllCalls).toBe(0); // nothing rebuilt
    expect(bundleCalls).toBe(0); // bundle skipped
  });

  test('recompileChanged on the entry file itself rebuilds just that entry', async () => {
    seededDeps.set(PAGE_A, new Set());
    seededDeps.set(PAGE_B, new Set());
    await registry.compileAll([PAGE_A, PAGE_B]);

    bundleCalls = 0;
    compileAllCalls = 0;

    const summary = await registry.recompileChanged(PAGE_A);

    expect(summary.pages.size).toBe(1);
    expect(compileAllCalls).toBe(1);
    expect(lastCompileAllArgs).toEqual([PAGE_A]);
    expect(bundleCalls).toBe(1);
  });

  // Regression: real callers register pages with relative paths
  // (`Mochi.page('./src/Site.svelte', ...)`), so a registry that keyed
  // `compiledComponents` / `entryDeps` by the caller's string could evict and
  // recompile under a *different* key than renderComponent looks up, and SSR
  // would keep serving the previous module. Every source key is resolved on the
  // way in now, so the relative and absolute forms are the same entry.
  test('recompileChanged reaches an entry registered with a relative path', async () => {
    const REL = './fake-rel/PageRel.svelte';
    const ABS = path.resolve(REL);
    const DEP = path.resolve('./fake-rel/dep.ts');
    seededDeps.set(ABS, new Set([DEP]));
    await registry.compileAll([REL]);

    const internals = registry as unknown as RegistryInternals;
    const beforeEntry = internals.compiledComponents.get(ABS);
    const beforeSize = internals.compiledComponents.size;
    expect(beforeEntry).toBeDefined();

    const summary = await registry.recompileChanged(DEP);

    // Public contract: pages are absolute (matches __mochi_page_entry).
    expect(summary.pages).toEqual(new Set([ABS]));

    // Smoking gun #1: the entry was REPLACED, not left stale.
    const afterEntry = internals.compiledComponents.get(ABS);
    expect(afterEntry).toBeDefined();
    expect(afterEntry).not.toBe(beforeEntry);

    // Smoking gun #2: the relative registration produced no second entry.
    expect(internals.compiledComponents.size).toBe(beforeSize);
    expect(internals.compiledComponents.has(REL)).toBe(false);
  });

  // Race-window regression: pre-fix, recompileChanged deleted the cache entry
  // before `await compile()` ran, leaving a window where renderComponent
  // (which does `compiledComponents.get(filename)!`) saw `undefined` and
  // crashed Svelte's renderer with "component is not a function". The fix is
  // that compileAll(force:true) overwrites in place; the old entry stays
  // valid until the new one swaps it via `set()`.
  test('compiledComponents entry stays defined throughout recompileChanged', async () => {
    seededDeps.set(PAGE_A, new Set());
    await registry.compileAll([PAGE_A]);

    const internals = registry as unknown as RegistryInternals;
    const beforeEntry = internals.compiledComponents.get(PAGE_A);
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

    const rebuild = registry.recompileChanged(PAGE_A);
    // Let recompileChanged enter the gated compileAll call.
    await Promise.resolve();
    await Promise.resolve();

    // Pre-fix this would be `undefined` (clearEntry already deleted it).
    expect(internals.compiledComponents.get(PAGE_A)).toBeDefined();
    // And it should still be the original module — not yet swapped.
    expect(internals.compiledComponents.get(PAGE_A)).toBe(beforeEntry);

    release();
    await rebuild;

    // Post-rebuild: entry replaced by the new module.
    const afterEntry = internals.compiledComponents.get(PAGE_A);
    expect(afterEntry).toBeDefined();
    expect(afterEntry).not.toBe(beforeEntry);
  });
});

// Integration anchor for the stubbed suite above: exercises recompileChanged /
// compileAll against the REAL Svelte + Bun.build pipeline so the stub's contract
// assumptions (path resolution, cached-entry filtering, entryDeps seeding, one
// trailing client bundle per cycle) stay tied to production behavior.
describe('recompile* against the real compileAll', () => {
  let dir: string;
  let registry: ComponentRegistry;
  let compileStarts: string[];
  let bundleEvents: number;
  let pageDep: string;
  let pageSolo: string;
  let sharedTs: string;

  const onCompileStart = ({ path: p }: { path: string }) => {
    compileStarts.push(p);
  };
  const onBundle = () => {
    bundleEvents += 1;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-recompile-real-'));
    registry = new ComponentRegistry({ development: true, outDir: path.join(dir, '.mochi') });
    sharedTs = path.join(dir, 'shared.ts');
    pageDep = path.join(dir, 'PageDep.svelte');
    pageSolo = path.join(dir, 'PageSolo.svelte');
    writeFileSync(sharedTs, "export const label = 'from-shared';\n");
    writeFileSync(path.join(dir, 'Widget.svelte'), '<button>widget</button>\n');
    writeFileSync(
      pageDep,
      '<script lang="ts">\n' +
        "  import { label } from './shared';\n" +
        "  import Widget from './Widget.svelte';\n" +
        '</script>\n\n<main>{label}<Widget mochi:hydrate /></main>\n',
    );
    writeFileSync(pageSolo, '<div>solo</div>\n');
    compileStarts = [];
    bundleEvents = 0;
    mochiEvents.on('compile:start', onCompileStart);
    mochiEvents.on('client-bundle:complete', onBundle);
  });

  afterEach(() => {
    mochiEvents.off('compile:start', onCompileStart);
    mochiEvents.off('client-bundle:complete', onBundle);
    rmSync(dir, { recursive: true, force: true });
  });

  test('recompileChanged walks the real dep graph and bundles once per cycle', async () => {
    await registry.compileAll([pageDep, pageSolo]);
    expect(new Set(compileStarts)).toEqual(new Set([pageDep, pageSolo]));
    expect(bundleEvents).toBe(1); // one trailing bundle for the whole cohort

    compileStarts = [];
    bundleEvents = 0;

    const summary = await registry.recompileChanged(sharedTs);
    expect(summary.pages).toEqual(new Set([pageDep])); // PageSolo's real dep graph excludes shared.ts
    expect(summary.clientBundleCount).toBe(1);
    expect(compileStarts).toEqual([pageDep]);
    expect(bundleEvents).toBe(1);

    const noop = await registry.recompileChanged(path.join(dir, 'unrelated.ts'));
    expect(noop.pages.size).toBe(0);
    expect(noop.clientBundleCount).toBe(0);
  });

  test('relative and absolute registrations resolve to one cached entry', async () => {
    const rel = path.relative(process.cwd(), pageSolo);
    await registry.compileAll([rel]);
    expect(compileStarts).toEqual([pageSolo]); // emitted paths are resolved absolute

    compileStarts = [];
    await registry.compileAll([pageSolo]);
    expect(compileStarts).toEqual([]); // cached under the resolved key → filtered out

    // The entry's own resolved path is in its dep set, so entry-as-changed-path rebuilds it.
    const summary = await registry.recompileChanged(pageSolo);
    expect(summary.pages).toEqual(new Set([pageSolo]));
    expect(compileStarts).toEqual([pageSolo]);
  });
});
