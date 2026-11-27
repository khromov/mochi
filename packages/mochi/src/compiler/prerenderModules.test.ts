import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  assertNotPrebuilt,
  collectInputs,
  createPrerenderModuleLoader,
  currentPrerenderEvaluationCache,
  emitPrerenderModule,
  evaluatePrerenderModule,
  resetPrerenderEvaluationCache,
  type PrerenderContext,
} from './prerenderModules';
import { prerenderEvaluation, createModuleRef, isModuleRef } from './prerenderSerialize';
import { moduleRef } from '../moduleRef';

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-prerender-modules-'));
  await Bun.write(path.join(dir, 'dep.ts'), `export const version = 'v1';\nexport const calls = { n: 0 };\n`);
  await Bun.write(
    path.join(dir, 'value.prerender.ts'),
    `import { version, calls } from './dep.ts';\nimport type { Component } from 'svelte';\ncalls.n += 1;\nexport const text = await Promise.resolve(version);\nexport const call = calls.n;\nexport type Unused = Component;\n`,
  );
  await Bun.write(path.join(dir, 'Card.svelte'), `<p>card</p>\n`);
  await Bun.write(path.join(dir, 'component.prerender.ts'), `import Card from './Card.svelte';\nexport const card = Card;\n`);
  await Bun.write(path.join(dir, 'throws.prerender.ts'), `throw new Error('boom');\n`);
  await Bun.write(path.join(dir, 'fn.prerender.ts'), `export const rows = [{ fn: () => 1 }];\n`);
  await Bun.write(path.join(dir, 'data.json'), `{ "n": 41 }\n`);
  await Bun.write(path.join(dir, 'json.prerender.ts'), `import data from './data.json';\nexport const n = data.n + 1;\n`);
  await Bun.write(path.join(dir, 'store.svelte.ts'), `export const s = $state({ n: 1 });\nexport const LIMIT = 5;\n`);
  await Bun.write(path.join(dir, 'runes.prerender.ts'), `import { LIMIT } from './store.svelte.ts';\nexport const limit = LIMIT;\n`);
  await Bun.write(
    path.join(dir, 'library.prerender.ts'),
    `import { uneval } from 'devalue';\nimport { moduleRef } from 'mochi-framework';\nexport const out = uneval(1);\nexport const ref = moduleRef('./Card.svelte');\n`,
  );
});

afterAll(() => {
  resetPrerenderEvaluationCache();
  rmSync(dir, { recursive: true, force: true });
});

const ctx = (): PrerenderContext => ({ development: true, isPrebuilt: () => false });

describe('emitPrerenderModule', () => {
  test('exports every value as a literal, covering default and string-named exports', () => {
    const out = emitPrerenderModule({ sources: [{ label: 'a', html: '<b>' }], default: { when: new Date(0) }, 'weird name': 1 }, '/app/x.prerender.ts');
    expect(out).toContain('export { __mochi_export_0__ as sources, __mochi_export_1__ as default, __mochi_export_2__ as "weird name" };');
    // Bun's parser must accept the string-named form, or the bundle fails on it.
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(out)).not.toThrow();
    expect(out).not.toContain('<b>');
  });

  test('turns module refs into imports shared across exports', () => {
    const out = emitPrerenderModule({ a: { intro: createModuleRef('../docs/10-intro.md') }, b: createModuleRef('../docs/10-intro.md') }, '/app/x.prerender.ts');
    expect(out.startsWith('import __mochi_ref_0__ from "../docs/10-intro.md";\n')).toBe(true);
    expect(out.match(/import __mochi_ref_/g)).toHaveLength(1);
    expect(out).toContain('const __mochi_export_1__ = __mochi_ref_0__;');
  });

  test('names the export and path of a value that cannot be inlined', () => {
    expect(() => emitPrerenderModule({ rows: [{ fn: () => 1 }] }, path.join(process.cwd(), 'src', 'x.prerender.ts'))).toThrow(
      /src\/x\.prerender\.ts exports "rows", which cannot be inlined: .* at rows\[0\]\.fn\./,
    );
  });
});

describe('evaluatePrerenderModule', () => {
  test('evaluates in-process and memoizes per path until reset', async () => {
    const file = path.join(dir, 'value.prerender.ts');
    const first = await evaluatePrerenderModule(file, ctx());
    expect(first.text).toBe('v1');
    expect(await evaluatePrerenderModule(file, ctx())).toBe(first);
    resetPrerenderEvaluationCache();
    expect(await evaluatePrerenderModule(file, ctx())).not.toBe(first);
  });

  test('re-runs the module and its first-party imports once the memo is reset', async () => {
    const file = path.join(dir, 'value.prerender.ts');
    resetPrerenderEvaluationCache();
    const before = await evaluatePrerenderModule(file, ctx());
    await Bun.write(path.join(dir, 'dep.ts'), `export const version = 'v2';\nexport const calls = { n: 0 };\n`);
    resetPrerenderEvaluationCache();
    const after = await evaluatePrerenderModule(file, ctx());
    expect(after.text).toBe('v2');
    // A fresh instance of dep.ts, not the cached one with its counter already bumped.
    expect(after.call).toBe(1);
    expect(before.call).toBe(1);
  });

  test('a production build keeps the module cache, so helpers are instantiated once', async () => {
    const file = path.join(dir, 'value.prerender.ts');
    resetPrerenderEvaluationCache();
    const first = await evaluatePrerenderModule(file, { ...ctx(), development: false });
    resetPrerenderEvaluationCache();
    const second = await evaluatePrerenderModule(file, { ...ctx(), development: false });
    // Nothing was evicted, so the second import is Bun's cached module rather than a fresh run of it.
    expect(second.call).toBe(first.call);
  });

  test('evaluations never overlap', async () => {
    resetPrerenderEvaluationCache();
    const order: string[] = [];
    await Bun.write(
      path.join(dir, 'slow.prerender.ts'),
      `globalThis.__order__.push('slow:start');\nawait new Promise((r) => setTimeout(r, 50));\nglobalThis.__order__.push('slow:end');\nexport const ok = true;\n`,
    );
    await Bun.write(path.join(dir, 'fast.prerender.ts'), `globalThis.__order__.push('fast');\nexport const ok = true;\n`);
    (globalThis as { __order__?: string[] }).__order__ = order;
    await Promise.all([evaluatePrerenderModule(path.join(dir, 'slow.prerender.ts'), ctx()), evaluatePrerenderModule(path.join(dir, 'fast.prerender.ts'), ctx())]);
    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
  });

  test('reports the first-party inputs, ignoring type-only imports', async () => {
    const file = path.join(dir, 'value.prerender.ts');
    const inputs = await collectInputs(file);
    expect([...inputs]).toEqual([file, path.join(dir, 'dep.ts')]);
    const seen: string[] = [];
    resetPrerenderEvaluationCache();
    await evaluatePrerenderModule(file, { ...ctx(), onInputs: (p, i) => seen.push(p, ...i) });
    expect(seen).toContain(path.join(dir, 'dep.ts'));
  });

  test('a JSON import is an input to evict but not a module to scan', async () => {
    const file = path.join(dir, 'json.prerender.ts');
    expect([...(await collectInputs(file))]).toEqual([file, path.join(dir, 'data.json')]);
    resetPrerenderEvaluationCache();
    expect((await evaluatePrerenderModule(file, ctx())).n).toBe(42);
    await Bun.write(path.join(dir, 'data.json'), `{ "n": 99 }\n`);
    resetPrerenderEvaluationCache();
    expect((await evaluatePrerenderModule(file, ctx())).n).toBe(100);
  });

  test('a package import is a library wherever it resolves, so the framework is neither scanned nor evicted', async () => {
    const file = path.join(dir, 'library.prerender.ts');
    expect([...(await collectInputs(file))]).toEqual([file]);
    resetPrerenderEvaluationCache();
    expect((await evaluatePrerenderModule(file, ctx())).out).toBe('1');
  });

  test('a production build scans only the module itself', async () => {
    const file = path.join(dir, 'value.prerender.ts');
    expect([...(await collectInputs(file, { transitive: false }))]).toEqual([file]);
    const seen: string[] = [];
    resetPrerenderEvaluationCache();
    await evaluatePrerenderModule(file, { ...ctx(), development: false, onInputs: (p) => seen.push(p) });
    expect(seen).toEqual([]);
    await expect(collectInputs(path.join(dir, 'component.prerender.ts'), { transitive: false })).rejects.toThrow(/moduleRef/);
  });

  test('a runes module import is rejected like a component', async () => {
    resetPrerenderEvaluationCache();
    const err = await evaluatePrerenderModule(path.join(dir, 'runes.prerender.ts'), ctx()).catch((e: Error) => e.message);
    expect(err).toMatch(/runes\.prerender\.ts imports "\.\/store\.svelte\.ts", but a \*\.prerender\.ts module runs outside the bundler/);
    expect(err).not.toContain('$state');
  });

  test('a compile keeps the memo it captured across a reset', async () => {
    const file = path.join(dir, 'value.prerender.ts');
    resetPrerenderEvaluationCache();
    const captured = currentPrerenderEvaluationCache();
    const ssr = await evaluatePrerenderModule(file, { ...ctx(), evaluations: captured });
    resetPrerenderEvaluationCache();
    expect(currentPrerenderEvaluationCache()).not.toBe(captured);
    // The client pass of the same compile still reads the value its SSR pass inlined.
    expect(await evaluatePrerenderModule(file, { ...ctx(), evaluations: captured })).toBe(ssr);
    expect(await evaluatePrerenderModule(file, ctx())).not.toBe(ssr);
  });

  test('a component import is rejected with the moduleRef hint', async () => {
    resetPrerenderEvaluationCache();
    const err = await evaluatePrerenderModule(path.join(dir, 'component.prerender.ts'), ctx()).catch((e: Error) => e.message);
    expect(err).toMatch(/component\.prerender\.ts imports "\.\/Card\.svelte", but a \*\.prerender\.ts module runs outside the bundler/);
    expect(err).toContain('Export moduleRef("./Card.svelte") instead');
    expect(err).not.toContain('\\');
  });

  test('a throw is attributed to the module, and the rejection is not memoized', async () => {
    resetPrerenderEvaluationCache();
    const file = path.join(dir, 'throws.prerender.ts');
    const pending = evaluatePrerenderModule(file, ctx());
    await expect(pending).rejects.toThrow(/throws\.prerender\.ts threw while evaluating: boom/);
    expect(evaluatePrerenderModule(file, ctx())).not.toBe(pending);
    await evaluatePrerenderModule(file, ctx()).catch(() => {});
  });
});

describe('moduleRef', () => {
  test('throws outside a build-time evaluation, naming the cause', () => {
    expect(prerenderEvaluation.active).toBe(0);
    expect(() => moduleRef('./Card.svelte')).toThrow(/moduleRef\("\.\/Card\.svelte"\) was called outside a build-time evaluation/);
  });

  test('marks a module while an evaluation is in flight', async () => {
    resetPrerenderEvaluationCache();
    const ns = await evaluatePrerenderModule(path.join(dir, 'library.prerender.ts'), ctx());
    expect(isModuleRef(ns.ref)).toBe(true);
    expect(prerenderEvaluation.active).toBe(0);
  });
});

describe('createPrerenderModuleLoader', () => {
  test('leaves a dependency module on the default loader', async () => {
    const load = createPrerenderModuleLoader(ctx());
    expect(await load({ path: '/app/node_modules/pkg/data.prerender.js' })).toBeUndefined();
  });

  test('returns the serialized module', async () => {
    resetPrerenderEvaluationCache();
    const load = createPrerenderModuleLoader(ctx());
    const result = await load({ path: path.join(dir, 'value.prerender.ts') });
    expect(result?.loader).toBe('js');
    // A module namespace lists its keys sorted, so the emitted order is stable across rebuilds.
    expect(result?.contents).toBe('const __mochi_export_0__ = 1;\nconst __mochi_export_1__ = "v2";\nexport { __mochi_export_0__ as call, __mochi_export_1__ as text };\n');
  });

  test('names a non-serializable export through the loader', async () => {
    resetPrerenderEvaluationCache();
    const load = createPrerenderModuleLoader(ctx());
    await expect(load({ path: path.join(dir, 'fn.prerender.ts') })).rejects.toThrow(/fn\.prerender\.ts exports "rows"/);
  });

  test('a prerendered module reached while a prebuilt manifest serves in production is a stale build', () => {
    expect(() => assertNotPrebuilt({ development: false, isPrebuilt: () => true }, '/app/src/x.prerender.ts')).toThrow(/stale\. Rebuild and redeploy/);
    expect(() => assertNotPrebuilt({ development: true, isPrebuilt: () => true }, '/app/src/x.prerender.ts')).not.toThrow();
    expect(() => assertNotPrebuilt({ development: false, isPrebuilt: () => false }, '/app/src/x.prerender.ts')).not.toThrow();
  });
});
