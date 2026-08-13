import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { classifyModules, evaluationOrder, hasDefaultExport, packageNameOf, planChunks, validateClientBundleOptions, viewId, type ChunkMetafile } from './clientBundleChunks';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'client-bundle-chunks');
const VENDOR_ONE = path.join(FIXTURE_DIR, 'vendorOne.ts');
const VENDOR_TWO = path.join(FIXTURE_DIR, 'vendorTwo.ts');

const metafile = (inputs: Record<string, { bytes: number; format?: string }>): ChunkMetafile => ({ inputs });

describe('packageNameOf', () => {
  test('reads the package out of a hoisted node_modules path', () => {
    expect(packageNameOf('/app/node_modules/chart.js/dist/chart.js')).toBe('chart.js');
  });

  test('keeps both segments of a scoped package', () => {
    expect(packageNameOf('/app/node_modules/@lucide/svelte/icons/sun.js')).toBe('@lucide/svelte');
  });

  test("sees through Bun's isolated-linker store layout", () => {
    expect(packageNameOf('/app/node_modules/.bun/chart.js@4.4.0/node_modules/chart.js/dist/chart.js')).toBe('chart.js');
    expect(packageNameOf('/app/node_modules/.bun/@lucide+svelte@1.0.0/node_modules/@lucide/svelte/i.js')).toBe('@lucide/svelte');
  });

  test('returns null for first-party source', () => {
    expect(packageNameOf('/app/src/components/Chart.svelte')).toBeNull();
  });
});

describe('validateClientBundleOptions', () => {
  test('passes through undefined', () => {
    expect(validateClientBundleOptions(undefined)).toBeUndefined();
  });

  test('rejects a non-object', () => {
    expect(() => validateClientBundleOptions('nope')).toThrow(/must be an object/);
    expect(() => validateClientBundleOptions([])).toThrow(/received array/);
  });

  test('names an unknown key', () => {
    expect(() => validateClientBundleOptions({ chunkNaming: 'x' })).toThrow(/Unknown clientBundle option "chunkNaming"/);
  });

  test('rejects a non-function chunks', () => {
    expect(() => validateClientBundleOptions({ chunks: 'vendor' })).toThrow(/clientBundle\.chunks must be a function/);
  });

  test('rejects a non-boolean splitting', () => {
    expect(() => validateClientBundleOptions({ splitting: 'yes' })).toThrow(/clientBundle\.splitting must be a boolean/);
  });

  // With splitting off Bun emits no shared chunks at all, so the pair would run the classifier and a second build pass
  // to produce nothing.
  test('rejects chunks together with splitting: false', () => {
    expect(() => validateClientBundleOptions({ chunks: () => null, splitting: false })).toThrow(/chunks needs clientBundle\.splitting/);
    expect(() => validateClientBundleOptions({ chunks: () => null, splitting: true })).not.toThrow();
  });
});

describe('evaluationOrder', () => {
  // Bun lists an output's inputs in the order it concatenated them; the input map is in parse order, which is why the
  // outputs are the ones read.
  test('reads the order modules were concatenated into each output', () => {
    const order = evaluationOrder(
      {
        inputs: {},
        outputs: { 'b.js': { inputs: { 'src/second.ts': {}, 'src/third.ts': {} } }, 'a.js': { inputs: { 'src/first.ts': {} } } },
      },
      '/app',
    );
    expect([...order.keys()]).toEqual(['/app/src/first.ts', '/app/src/second.ts', '/app/src/third.ts']);
  });

  test('a module in two outputs keeps its first position', () => {
    const order = evaluationOrder({ inputs: {}, outputs: { 'a.js': { inputs: { 'x.ts': {}, 'y.ts': {} } }, 'b.js': { inputs: { 'y.ts': {} } } } }, '/app');
    expect(order.get('/app/y.ts')).toBe(1);
  });

  test('a metafile with no outputs yields no order', () => {
    expect(evaluationOrder({ inputs: {} }, '/app').size).toBe(0);
  });
});

describe('classifyModules', () => {
  test('assigns real files the classifier names', () => {
    const { chunkOf } = classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => 'vendor');
    expect([...chunkOf.values()]).toEqual(['vendor']);
  });

  test('leaves modules the classifier passes on', () => {
    const { chunkOf } = classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => null);
    expect(chunkOf.size).toBe(0);
  });

  // Virtual modules are excluded by an existence check, so the framework's own `mochi-env:` / `mochi-server-only:`
  // namespaces and the synthetic `_hydrate-*.js` entries drop out without this module knowing any of their names.
  test('skips virtual modules that have no file on disk', () => {
    const { chunkOf } = classifyModules(metafile({ 'mochi-env:mochi-framework': { bytes: 10 }, '_hydrate-Widget_ab.js': { bytes: 10 } }), () => 'vendor');
    expect(chunkOf.size).toBe(0);
  });

  test('never moves an entrypoint', () => {
    const { chunkOf } = classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => 'vendor', {
      entrypoints: new Set([VENDOR_ONE.replace(/\\/g, '/')]),
    });
    expect(chunkOf.size).toBe(0);
  });

  // A CJS module's named exports are synthesized by the bundler, after the point a view module must declare them, so
  // relocating one fails the build on any named import of it.
  test('skips CommonJS and reports why', () => {
    const { chunkOf, skipped } = classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'cjs' } }), () => 'vendor');
    expect(chunkOf.size).toBe(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain('CommonJS');
  });

  test('hands the classifier a POSIX id and package context', () => {
    const seen: { id: string; pkg: string | null; rel: string }[] = [];
    classifyModules(metafile({ [VENDOR_ONE]: { bytes: 42, format: 'esm' } }), (id, ctx) => {
      seen.push({ id, pkg: ctx.packageName, rel: ctx.relativeId });
      return null;
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).not.toContain('\\');
    expect(seen[0]!.rel).not.toContain('\\');
    expect(seen[0]!.id.endsWith('/vendorOne.ts')).toBe(true);
    expect(seen[0]!.pkg).toBeNull();
  });

  test('rejects a non-string, non-nullish return', () => {
    expect(() => classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => 42 as unknown as string)).toThrow(/returned 42 .*vendorOne\.ts/);
  });

  test('rejects an empty chunk name', () => {
    expect(() => classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => '  ')).toThrow(/empty chunk name/);
  });

  test('rejects a name that is not filename-safe', () => {
    expect(() => classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => '../escape')).toThrow(/Invalid chunk name/);
    expect(() => classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => 'a/b')).toThrow(/Invalid chunk name/);
  });

  test('rejects a name Mochi reserves', () => {
    expect(() => classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => 'chunk')).toThrow(/is reserved by Mochi/);
  });

  test('surfaces a throwing classifier with the module it was called on', () => {
    expect(() =>
      classifyModules(metafile({ [VENDOR_ONE]: { bytes: 10, format: 'esm' } }), () => {
        throw new Error('boom');
      }),
    ).toThrow(/threw while classifying "[^"]*vendorOne\.ts": boom/);
  });
});

describe('planChunks', () => {
  const always = () => true;

  test('emits one view per member', () => {
    const plan = planChunks(
      new Map([
        [VENDOR_ONE, 'vendor'],
        [VENDOR_TWO, 'vendor'],
      ]),
      always,
    );
    expect(plan.members.get('vendor')).toHaveLength(2);
    expect(plan.sources.size).toBe(2);
  });

  // Reaching any member has to reach all of them, or their entrypoint-reachability sets differ and Bun splits them up.
  test('views form a ring and each re-exports its real module', () => {
    const plan = planChunks(
      new Map([
        [VENDOR_ONE, 'vendor'],
        [VENDOR_TWO, 'vendor'],
      ]),
      always,
    );
    const [first, second] = plan.members.get('vendor')!;
    // Paths are JSON-quoted into generated source, which on Windows escapes every separator — so the expectation has
    // to be built the same way rather than interpolated raw.
    expect(plan.sources.get(viewId(first!))).toContain(`import ${JSON.stringify(viewId(second!))};`);
    expect(plan.sources.get(viewId(second!))).toContain(`import ${JSON.stringify(viewId(first!))};`);
    expect(plan.sources.get(viewId(first!))).toContain(`export * from ${JSON.stringify(first)};`);
  });

  // Grouping relocates a module's initialization; emitting the ring import first would run the group back to front, so
  // a member's own re-export has to come before it walks on to the next view.
  test('a view runs its own module before the rest of the ring', () => {
    const plan = planChunks(
      new Map([
        [VENDOR_ONE, 'vendor'],
        [VENDOR_TWO, 'vendor'],
      ]),
      always,
    );
    const [first] = plan.members.get('vendor')!;
    const source = plan.sources.get(viewId(first!))!;
    expect(source.indexOf('export * from')).toBeLessThan(source.indexOf('import "view:'));
  });

  // Ring order is evaluation order, so whichever member is reached first walks the others in the sequence they already
  // ran in. Alphabetical order is only the tie-break for modules pass 1 never placed together.
  test('members are laid out in the evaluation order the build reported', () => {
    const order = new Map([
      [VENDOR_TWO, 0],
      [VENDOR_ONE, 1],
    ]);
    const plan = planChunks(
      new Map([
        [VENDOR_ONE, 'vendor'],
        [VENDOR_TWO, 'vendor'],
      ]),
      always,
      order,
    );
    expect(plan.members.get('vendor')).toEqual([VENDOR_TWO, VENDOR_ONE]);
  });

  // The ring is what keeps this linear rather than every-view-imports-every-other.
  test('emits one sibling import per member, not one per pair', () => {
    const members = new Map([...Array(6)].map((_, i) => [`${FIXTURE_DIR}/m${i}.ts`, 'big'] as const));
    const plan = planChunks(new Map(members), always);
    const total = [...plan.sources.values()].reduce((n, s) => n + (s.match(/^import "view:/gm) ?? []).length, 0);
    expect(total).toBe(6);
  });

  test('a lone member has no sibling import to make', () => {
    const plan = planChunks(new Map([[VENDOR_ONE, 'solo']]), always);
    expect(plan.sources.get(`view:${VENDOR_ONE}`)).not.toContain('import "view:');
  });

  // `export *` carries every named export, including re-exported ones, but never `default`.
  test('re-exports default only when the module has one', () => {
    const withDefault = planChunks(new Map([[VENDOR_ONE, 'vendor']]), () => true).sources.get(`view:${VENDOR_ONE}`)!;
    expect(withDefault).toContain('export { default } from');

    const without = planChunks(new Map([[VENDOR_ONE, 'vendor']]), () => false).sources.get(`view:${VENDOR_ONE}`)!;
    expect(without).not.toContain('export { default }');
  });

  test('members are sorted so two runs of one config plan identically', () => {
    const a = planChunks(
      new Map([
        [VENDOR_TWO, 'v'],
        [VENDOR_ONE, 'v'],
      ]),
      always,
    );
    const b = planChunks(
      new Map([
        [VENDOR_ONE, 'v'],
        [VENDOR_TWO, 'v'],
      ]),
      always,
    );
    expect(a.members.get('v')).toEqual(b.members.get('v')!);
    expect(a.sources.get(`view:${VENDOR_ONE}`)).toBe(b.sources.get(`view:${VENDOR_ONE}`)!);
  });

  // Two names must not cross-import, or both groups collapse into one chunk.
  test('separate names stay separate groups', () => {
    const plan = planChunks(
      new Map([
        [VENDOR_ONE, 'one'],
        [VENDOR_TWO, 'two'],
      ]),
      always,
    );
    expect([...plan.members.keys()].sort()).toEqual(['one', 'two']);
    expect(plan.sources.get(`view:${VENDOR_ONE}`)).not.toContain(VENDOR_TWO);
  });
});

describe('hasDefaultExport', () => {
  test('detects a declared default', () => {
    expect(hasDefaultExport('/x/a.ts', () => 'export default class {}')).toBe(true);
    expect(hasDefaultExport('/x/a.ts', () => 'export const only = 1;')).toBe(false);
  });

  test('assumes a default for sources compiled later in the build', () => {
    expect(hasDefaultExport('/x/Widget.svelte', () => 'unparseable as TS')).toBe(true);
  });

  test('returns null for an extension it cannot read', () => {
    expect(hasDefaultExport('/x/style.css', () => 'body{}')).toBeNull();
  });
});

describe('protected packages', () => {
  // Chunking Svelte builds cleanly and then throws on hydration in the browser, so it is refused up front rather than
  // left to fail at runtime. Uses the real installed path, since membership is derived from the module path.
  test("refuses to move Svelte's runtime and says why", () => {
    // Deep internal paths are not exported by svelte's package.json, so anchor on the package root instead.
    const sveltePath = path.join(path.dirname(Bun.resolveSync('svelte/package.json', path.join(import.meta.dir, '..', '..'))), 'src/internal/client/index.js');
    const { chunkOf, skipped } = classifyModules(metafile({ [sveltePath]: { bytes: 10, format: 'esm' } }), () => 'vendor');
    expect(chunkOf.size).toBe(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain('svelte runtime');
  });

  test('leaves other packages alone', () => {
    const other = Bun.resolveSync('devalue', path.join(import.meta.dir, '..', '..'));
    const { chunkOf } = classifyModules(metafile({ [other]: { bytes: 10, format: 'esm' } }), () => 'vendor');
    expect(chunkOf.size).toBe(1);
  });
});
