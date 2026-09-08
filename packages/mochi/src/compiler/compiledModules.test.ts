import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  assertNotPrebuilt,
  collectInputs,
  createCompiledModuleLoader,
  emitCompiledModule,
  evaluateCompiledModule,
  resetCompiledEvaluationCache,
  type CompiledContext,
} from './compiledModules';
import { createModuleRef } from './compiledSerialize';

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-compiled-modules-'));
  await Bun.write(path.join(dir, 'dep.ts'), `export const version = 'v1';\nexport const calls = { n: 0 };\n`);
  await Bun.write(
    path.join(dir, 'value.compiled.ts'),
    `import { version, calls } from './dep.ts';\nimport type { Component } from 'svelte';\ncalls.n += 1;\nexport const text = await Promise.resolve(version);\nexport const call = calls.n;\nexport type Unused = Component;\n`,
  );
  await Bun.write(path.join(dir, 'Card.svelte'), `<p>card</p>\n`);
  await Bun.write(path.join(dir, 'component.compiled.ts'), `import Card from './Card.svelte';\nexport const card = Card;\n`);
  await Bun.write(path.join(dir, 'throws.compiled.ts'), `throw new Error('boom');\n`);
  await Bun.write(path.join(dir, 'fn.compiled.ts'), `export const rows = [{ fn: () => 1 }];\n`);
  await Bun.write(path.join(dir, 'data.json'), `{ "n": 41 }\n`);
  await Bun.write(path.join(dir, 'json.compiled.ts'), `import data from './data.json';\nexport const n = data.n + 1;\n`);
});

afterAll(() => {
  resetCompiledEvaluationCache();
  rmSync(dir, { recursive: true, force: true });
});

const ctx = (): CompiledContext => ({ development: true, isPrebuilt: () => false });

describe('emitCompiledModule', () => {
  test('exports every value as a literal, covering default and string-named exports', () => {
    const out = emitCompiledModule({ sources: [{ label: 'a', html: '<b>' }], default: { when: new Date(0) }, 'weird name': 1 }, '/app/x.compiled.ts');
    expect(out).toContain('export { __mochi_export_0__ as sources, __mochi_export_1__ as default, __mochi_export_2__ as "weird name" };');
    // Bun's parser must accept the string-named form, or the bundle fails on it.
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(out)).not.toThrow();
    expect(out).not.toContain('<b>');
  });

  test('turns module refs into imports shared across exports', () => {
    const out = emitCompiledModule({ a: { intro: createModuleRef('../docs/10-intro.md') }, b: createModuleRef('../docs/10-intro.md') }, '/app/x.compiled.ts');
    expect(out.startsWith('import __mochi_ref_0__ from "../docs/10-intro.md";\n')).toBe(true);
    expect(out.match(/import __mochi_ref_/g)).toHaveLength(1);
    expect(out).toContain('const __mochi_export_1__ = __mochi_ref_0__;');
  });

  test('names the export and path of a value that cannot be inlined', () => {
    expect(() => emitCompiledModule({ rows: [{ fn: () => 1 }] }, path.join(process.cwd(), 'src', 'x.compiled.ts'))).toThrow(
      /src\/x\.compiled\.ts exports "rows", which cannot be inlined: .* at rows\[0\]\.fn\./,
    );
  });
});

describe('evaluateCompiledModule', () => {
  test('evaluates in-process and memoizes per path until reset', async () => {
    const file = path.join(dir, 'value.compiled.ts');
    const first = await evaluateCompiledModule(file, ctx());
    expect(first.text).toBe('v1');
    expect(await evaluateCompiledModule(file, ctx())).toBe(first);
    resetCompiledEvaluationCache();
    expect(await evaluateCompiledModule(file, ctx())).not.toBe(first);
  });

  test('re-runs the module and its first-party imports once the memo is reset', async () => {
    const file = path.join(dir, 'value.compiled.ts');
    resetCompiledEvaluationCache();
    const before = await evaluateCompiledModule(file, ctx());
    await Bun.write(path.join(dir, 'dep.ts'), `export const version = 'v2';\nexport const calls = { n: 0 };\n`);
    resetCompiledEvaluationCache();
    const after = await evaluateCompiledModule(file, ctx());
    expect(after.text).toBe('v2');
    // A fresh instance of dep.ts, not the cached one with its counter already bumped.
    expect(after.call).toBe(1);
    expect(before.call).toBe(1);
  });

  test('a production build keeps the module cache, so helpers are instantiated once', async () => {
    const file = path.join(dir, 'value.compiled.ts');
    resetCompiledEvaluationCache();
    const first = await evaluateCompiledModule(file, { ...ctx(), development: false });
    resetCompiledEvaluationCache();
    const second = await evaluateCompiledModule(file, { ...ctx(), development: false });
    // Nothing was evicted, so the second import is Bun's cached module rather than a fresh run of it.
    expect(second.call).toBe(first.call);
  });

  test('evaluations never overlap', async () => {
    resetCompiledEvaluationCache();
    const order: string[] = [];
    await Bun.write(
      path.join(dir, 'slow.compiled.ts'),
      `globalThis.__order__.push('slow:start');\nawait new Promise((r) => setTimeout(r, 50));\nglobalThis.__order__.push('slow:end');\nexport const ok = true;\n`,
    );
    await Bun.write(path.join(dir, 'fast.compiled.ts'), `globalThis.__order__.push('fast');\nexport const ok = true;\n`);
    (globalThis as { __order__?: string[] }).__order__ = order;
    await Promise.all([evaluateCompiledModule(path.join(dir, 'slow.compiled.ts'), ctx()), evaluateCompiledModule(path.join(dir, 'fast.compiled.ts'), ctx())]);
    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
  });

  test('reports the first-party inputs, ignoring type-only imports', async () => {
    const file = path.join(dir, 'value.compiled.ts');
    const inputs = await collectInputs(file);
    expect([...inputs]).toEqual([file, path.join(dir, 'dep.ts')]);
    const seen: string[] = [];
    resetCompiledEvaluationCache();
    await evaluateCompiledModule(file, { ...ctx(), onInputs: (p, i) => seen.push(p, ...i) });
    expect(seen).toContain(path.join(dir, 'dep.ts'));
  });

  test('a JSON import is an input to evict but not a module to scan', async () => {
    const file = path.join(dir, 'json.compiled.ts');
    expect([...(await collectInputs(file))]).toEqual([file, path.join(dir, 'data.json')]);
    resetCompiledEvaluationCache();
    expect((await evaluateCompiledModule(file, ctx())).n).toBe(42);
    await Bun.write(path.join(dir, 'data.json'), `{ "n": 99 }\n`);
    resetCompiledEvaluationCache();
    expect((await evaluateCompiledModule(file, ctx())).n).toBe(100);
  });

  test('a component import is rejected with the moduleRef hint', async () => {
    resetCompiledEvaluationCache();
    const err = await evaluateCompiledModule(path.join(dir, 'component.compiled.ts'), ctx()).catch((e: Error) => e.message);
    expect(err).toMatch(/component\.compiled\.ts imports "\.\/Card\.svelte", but a \*\.compiled\.ts module runs outside the bundler/);
    expect(err).toContain('Export moduleRef("./Card.svelte") instead');
    expect(err).not.toContain('\\');
  });

  test('a throw is attributed to the module, and the rejection is not memoized', async () => {
    resetCompiledEvaluationCache();
    const file = path.join(dir, 'throws.compiled.ts');
    const pending = evaluateCompiledModule(file, ctx());
    await expect(pending).rejects.toThrow(/throws\.compiled\.ts threw while evaluating: boom/);
    expect(evaluateCompiledModule(file, ctx())).not.toBe(pending);
    await evaluateCompiledModule(file, ctx()).catch(() => {});
  });
});

describe('createCompiledModuleLoader', () => {
  test('leaves a dependency module on the default loader', async () => {
    const load = createCompiledModuleLoader(ctx());
    expect(await load({ path: '/app/node_modules/pkg/data.compiled.js' })).toBeUndefined();
  });

  test('returns the serialized module', async () => {
    resetCompiledEvaluationCache();
    const load = createCompiledModuleLoader(ctx());
    const result = await load({ path: path.join(dir, 'value.compiled.ts') });
    expect(result?.loader).toBe('js');
    // A module namespace lists its keys sorted, so the emitted order is stable across rebuilds.
    expect(result?.contents).toBe('const __mochi_export_0__ = 1;\nconst __mochi_export_1__ = "v2";\nexport { __mochi_export_0__ as call, __mochi_export_1__ as text };\n');
  });

  test('names a non-serializable export through the loader', async () => {
    resetCompiledEvaluationCache();
    const load = createCompiledModuleLoader(ctx());
    await expect(load({ path: path.join(dir, 'fn.compiled.ts') })).rejects.toThrow(/fn\.compiled\.ts exports "rows"/);
  });

  test('a build-time module reached while a prebuilt manifest serves in production is a stale build', () => {
    expect(() => assertNotPrebuilt({ development: false, isPrebuilt: () => true }, '/app/src/x.compiled.ts')).toThrow(/stale\. Rebuild and redeploy/);
    expect(() => assertNotPrebuilt({ development: true, isPrebuilt: () => true }, '/app/src/x.compiled.ts')).not.toThrow();
    expect(() => assertNotPrebuilt({ development: false, isPrebuilt: () => false }, '/app/src/x.compiled.ts')).not.toThrow();
  });
});
