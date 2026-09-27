import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_JS_MINIFIER, isJsMinifier, minifyBuildOutputs, minifyJsChunks, resetOxcMinifyCache, resolveOxcMinify } from './jsMinifier';

afterEach(() => {
  resetOxcMinifyCache();
});

describe('isJsMinifier', () => {
  test.each([
    ['bun', true],
    ['oxc', true],
    ['esbuild', false],
    ['', false],
    [undefined, false],
    [1, false],
  ])('%p -> %p', (value, expected) => {
    expect(isJsMinifier(value)).toBe(expected);
  });

  test('the default is the pre-existing Bun path', () => {
    expect(DEFAULT_JS_MINIFIER).toBe('bun');
  });
});

// oxc-minify resolves in this workspace, so the failure modes users actually hit — package absent, package broken —
// go through the injected loader.
describe('resolveOxcMinify', () => {
  test('throws with install instructions when the import rejects', async () => {
    const load = () => Promise.reject(new Error("Cannot find module 'oxc-minify'"));

    await expect(resolveOxcMinify(load)).rejects.toThrow(/bun add -d oxc-minify/);
  });

  test('throws when the package exports no minify function', async () => {
    await expect(resolveOxcMinify(() => Promise.resolve({}))).rejects.toThrow(/exports no `minify` function/);
  });

  test('a failed resolution is not memoized, so installing the peer and rebuilding works', async () => {
    await expect(resolveOxcMinify(() => Promise.reject(new Error('nope')))).rejects.toThrow();

    const fn = () => Promise.resolve({ code: '', errors: [], legalComments: [] });
    expect(await resolveOxcMinify(() => Promise.resolve({ minify: fn }))).toBe(fn);
  });

  test('resolves the real package', async () => {
    expect(typeof (await resolveOxcMinify())).toBe('function');
  });
});

describe('minifyJsChunks', () => {
  test('shrinks code and preserves behaviour', async () => {
    const source = 'export function addTogether(firstNumber, secondNumber) {\n  const sum = firstNumber + secondNumber;\n  return sum;\n}\n';

    const [out] = await minifyJsChunks([{ fileName: 'a.js', code: source }]);

    expect(out!.code.length).toBeLessThan(source.length);
    expect(out!.code).not.toContain('firstNumber');
    expect(out!.map).toBeUndefined();
  });

  test('an empty batch never loads the minifier', async () => {
    expect(await minifyJsChunks([])).toEqual([]);
  });

  test('throws naming every failing chunk rather than returning partial output', async () => {
    const good = { fileName: 'good.js', code: 'export const a = 1;' };
    const bad = { fileName: 'broken.js', code: 'export const = ;' };

    await expect(minifyJsChunks([good, bad])).rejects.toThrow(/broken\.js/);
  });
});

describe('minifyBuildOutputs', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function buildFixture(opts: { sourcemap?: 'linked' } = {}) {
    // Inside the package tree, like every other build-running test here — see CLAUDE.md on outDir placement.
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-js-minifier-'));
    writeFileSync(
      path.join(dir, 'lib.ts'),
      'export function addTogether(firstNumber: number, secondNumber: number) {\n  const sum = firstNumber + secondNumber;\n  return sum;\n}\n',
    );
    writeFileSync(path.join(dir, 'entry.ts'), 'import { addTogether } from "./lib";\nglobalThis.result = addTogether(1, 2);\n');
    return Bun.build({
      entrypoints: [path.join(dir, 'entry.ts')],
      outdir: path.join(dir, 'out'),
      target: 'browser',
      minify: true,
      ...(opts.sourcemap ? { sourcemap: opts.sourcemap } : {}),
    });
  }

  test("returns null for the default 'bun' mode, leaving Bun's output untouched", async () => {
    const result = await buildFixture();

    expect(await minifyBuildOutputs(result.outputs, 'bun')).toBeNull();
  });

  test('re-minifies JS chunks below what Bun alone produced, and the result still runs', async () => {
    const result = await buildFixture();
    const js = result.outputs.find((o) => o.kind === 'entry-point')!;
    const bunCode = await js.text();

    const out = (await minifyBuildOutputs(result.outputs, 'oxc'))!;

    const oxcCode = out.get(js.path)!;
    expect(oxcCode.length).toBeLessThan(bunCode.length);
    const scope: { result?: number } = {};
    new Function('globalThis', oxcCode)(scope);
    expect(scope.result).toBe(3);
  });

  test('chains the sourcemap so it still points at the original sources', async () => {
    const result = await buildFixture({ sourcemap: 'linked' });
    const js = result.outputs.find((o) => o.kind === 'entry-point')!;

    const out = (await minifyBuildOutputs(result.outputs, 'oxc'))!;

    const chained = JSON.parse(out.get(js.sourcemap!.path)!) as { sources: string[]; mappings: string };
    expect(chained.sources.some((s) => s.endsWith('lib.ts'))).toBe(true);
    expect(chained.mappings.length).toBeGreaterThan(0);
  });
});
