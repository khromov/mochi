import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertNoModuleSyntax,
  DEFAULT_JS_MINIFIER,
  isJsMinifier,
  minifyBuildOutputs,
  minifyJsChunks,
  resetOxcMinifyCache,
  resolveMinifierChoice,
  resolveOxcMinify,
} from './jsMinifier';

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

// Regressions for the classic-script and option-parity bugs the browser sweep turned up. Each of these is a way the
// second pass could change behaviour rather than just size.
describe('oxc option parity with Bun', () => {
  test('keeps legal comments, which oxc drops by default', async () => {
    const source = '/*! Copyright Someone. @license MIT */\nexport const a = 1;\n';

    const [out] = await minifyJsChunks([{ fileName: 'legal.js', code: source }]);

    expect(out!.code).toContain('@license MIT');
  });

  test('keeps `debugger`, which oxc drops by default and Bun preserves', async () => {
    const source = 'export function f() { debugger; return 1; }';

    const [out] = await minifyJsChunks([{ fileName: 'dbg.js', code: source }]);

    expect(out!.code).toContain('debugger');
  });

  test('keeps `console.*`, since dropping it would silence a running app', async () => {
    const [out] = await minifyJsChunks([{ fileName: 'log.js', code: 'export const f = () => console.log("kept");' }]);

    expect(out!.code).toContain('console.log');
  });

  test('keeps a bare property read, which is how Svelte tracks an $effect dependency', async () => {
    // `obj.prop;` as a statement looks dead; `treeshake.propertyReadSideEffects: 'always'` is what keeps it.
    const source = 'export function track(obj, run) { obj.prop; obj.nested.deep; run(); }';

    const [out] = await minifyJsChunks([{ fileName: 'reactive.js', code: source }]);

    expect(out!.code).toContain('.prop');
    expect(out!.code).toContain('.deep');
  });
});

describe('classic-script mode', () => {
  const source = 'const unusedTopLevelGlobal = 1;\nclass SomeWidget extends HTMLElement {}\ncustomElements.define("x-y", SomeWidget);\n';

  test('module mode mangles and drops top-level bindings', async () => {
    const [out] = await minifyJsChunks([{ fileName: 'm.js', code: source }], { module: true });

    expect(out!.code).not.toContain('unusedTopLevelGlobal');
    expect(out!.code).not.toContain('SomeWidget');
  });

  test('script mode keeps them, because a classic script’s top level is the global scope', async () => {
    // Renaming these to one-letter names is what makes a `SyntaxError` against another classic script's top-level
    // `let`/`const`/`class` likely; dropping them would delete a global the page can observe.
    const [out] = await minifyJsChunks([{ fileName: 's.js', code: source }], { module: false });

    expect(out!.code).toContain('unusedTopLevelGlobal');
    expect(out!.code).toContain('SomeWidget');
  });

  test('script mode does NOT itself reject module syntax, so the classic-script guard has to be explicit', async () => {
    // oxc parses `export` even with `module: false` and passes it through, so `assertNoModuleSyntax` is what stands
    // between an ESM-shaped bundle and a SyntaxError inside `<script>`.
    const [out] = await minifyJsChunks([{ fileName: 'esm.js', code: 'export const a = 1;' }], { module: false });

    expect(out!.code).toContain('export');
    expect(() => assertNoModuleSyntax('esm.js', out!.code)).toThrow(/classic <script>/);
  });

  test('the guard passes a self-contained classic script', () => {
    expect(() => assertNoModuleSyntax('ok.js', 'var a=1;customElements.define("x-y",class extends HTMLElement{});')).not.toThrow();
  });

  test('the guard allows a dynamic import, which a classic script can run', () => {
    expect(() => assertNoModuleSyntax('ok.js', 'import("./x.js").then(m=>m.go());')).not.toThrow();
  });
});

describe('resolveMinifierChoice', () => {
  const saved = process.env.MOCHI_MINIFIER;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.MOCHI_MINIFIER;
    } else {
      process.env.MOCHI_MINIFIER = saved;
    }
  });

  test('falls back to the configured value, then the default', () => {
    delete process.env.MOCHI_MINIFIER;
    expect(resolveMinifierChoice(undefined)).toBe('bun');
    expect(resolveMinifierChoice('oxc')).toBe('oxc');
  });

  test('the env var wins, so dev — which has no build flag — can be A/B’d', () => {
    process.env.MOCHI_MINIFIER = 'oxc';
    expect(resolveMinifierChoice(undefined)).toBe('oxc');
    expect(resolveMinifierChoice('bun')).toBe('oxc');
  });

  test('an unrecognised value is ignored rather than guessed at', () => {
    process.env.MOCHI_MINIFIER = 'terser';
    expect(resolveMinifierChoice('oxc')).toBe('oxc');
    expect(resolveMinifierChoice(undefined)).toBe('bun');
  });
});

// The pinned options only help if they actually reach oxc. This asserts the one that matters most is load-bearing:
// with the opposite setting the read is deleted, which is exactly how a Svelte $effect would lose its dependency.
describe('pinned options reach oxc', () => {
  test('a bare property read survives here but not under the opposite treeshake setting', async () => {
    const source = 'export function track(obj) { obj.prop; return 1; }';
    const minify = await resolveOxcMinify();

    const [pinned] = await minifyJsChunks([{ fileName: 'a.js', code: source }]);
    const loose = await minify('a.js', source, { module: true, compress: { treeshake: { propertyReadSideEffects: false } } });

    expect(pinned!.code).toContain('.prop');
    expect(loose.code).not.toContain('.prop');
  });
});
