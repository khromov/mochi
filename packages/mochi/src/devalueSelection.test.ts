/**
 * `useOptimizedDevalue` has no observable effect on output — that is the whole point — so what has to be tested is
 * the wiring: that the selector and the generated `mochi-env` modules both move to the other implementation, and
 * that they move together.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { devalueErrorPath, getUseOptimizedDevalue, parse, setUseOptimizedDevalue, stringify } from './utils/devalue';
import { devalueModulePath } from './compiler/devaluePath';
import { devalueAliasPlugin } from './compiler/devalueAlias';
import { renderMochiEnvClient, renderMochiEnvServer } from './compiler/virtualModuleTemplate';
import { toPosixPath } from './utils/index';

const VENDORED_SUFFIX = toPosixPath(path.join('src', 'vendor', 'devalue', 'index.ts'));

afterEach(() => {
  setUseOptimizedDevalue(true);
});

describe('the devalue selector', () => {
  test('defaults to the vendored build', () => {
    expect(getUseOptimizedDevalue()).toBe(true);
    expect(devalueModulePath().endsWith(VENDORED_SUFFIX)).toBe(true);
  });

  test('falls back to the npm package when turned off', () => {
    setUseOptimizedDevalue(false);
    expect(getUseOptimizedDevalue()).toBe(false);
    const resolved = devalueModulePath();
    expect(resolved).toContain('node_modules');
    expect(resolved.endsWith(VENDORED_SUFFIX)).toBe(false);
  });

  test('serializes identically either way, which is why the switch is safe', () => {
    const value = { when: new Date(1700000000000), tags: new Set(['a', 'b']), big: 1n, nested: { html: '<div>&amp;</div>' } };
    const optimized = stringify(value);
    setUseOptimizedDevalue(false);
    expect(stringify(value)).toBe(optimized);
    // And each side reads what the other wrote.
    expect(stringify(parse(optimized))).toBe(optimized);
  });
});

describe('the generated mochi-env modules', () => {
  test('bake the vendored path by default', () => {
    expect(renderMochiEnvServer(false)).toContain(VENDORED_SUFFIX);
    expect(renderMochiEnvClient(false, 'cookies.ts', 'enhance.ts')).toContain(VENDORED_SUFFIX);
  });

  test('bake the npm path when turned off', () => {
    setUseOptimizedDevalue(false);
    expect(renderMochiEnvServer(false)).toContain('node_modules');
    expect(renderMochiEnvServer(false)).not.toContain(VENDORED_SUFFIX);
    expect(renderMochiEnvClient(false, 'cookies.ts', 'enhance.ts')).not.toContain(VENDORED_SUFFIX);
  });

  test('never leave the placeholder token behind', () => {
    for (const flag of [true, false]) {
      setUseOptimizedDevalue(flag);
      expect(renderMochiEnvServer(false)).not.toContain('__MOCHI_DEVALUE__');
      expect(renderMochiEnvClient(false, 'cookies.ts', 'enhance.ts')).not.toContain('__MOCHI_DEVALUE__');
    }
  });
});

/**
 * The selector's dispatch must never survive into a bundle: it reads a runtime flag the bundle cannot see, and it
 * pulls both devalue copies in with it. Only `devalueAliasPlugin` prevents that, and it does so silently, so this
 * builds through the plugin rather than asserting on the functions it calls.
 */
describe('the bundler alias', () => {
  const SELECTOR = toPosixPath(path.join(import.meta.dir, 'utils', 'devalue.ts'));
  const VENDORED = toPosixPath(path.join(import.meta.dir, 'vendor', 'devalue', 'index.ts'));
  // Built at collection time, not in `beforeAll`, so the symlink case below knows whether it can run.
  const fixtureDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-devalue-alias-'));
  const entry = path.join(fixtureDir, 'entry.ts');
  const selectorSpecifier = toPosixPath(path.relative(fixtureDir, SELECTOR));

  // A user module that merely shares the selector's name is not the selector, and the plugin's filter sees it too.
  writeFileSync(path.join(fixtureDir, 'devalue.ts'), `export const marker = 'user-owned-devalue';\n`);
  // Both spellings, because framework code imports the selector without the extension and the alias matches on the
  // resolved path.
  writeFileSync(
    entry,
    `import { stringify } from '${selectorSpecifier}';\nimport { parse } from '${selectorSpecifier.replace(/\.ts$/, '')}';\nexport { marker } from './devalue';\nexport const out = parse(stringify({ a: 1 }));\n`,
  );

  // A `workspace:*` consumer reaches the framework through a symlinked `node_modules/mochi-framework`, which is where
  // a path compare that skipped realpath let the selector through. Windows may refuse to create the symlink.
  let symlinkedEntry: string | undefined = path.join(fixtureDir, 'linked-entry.ts');
  try {
    symlinkSync(import.meta.dir, path.join(fixtureDir, 'linked-src'), 'dir');
    writeFileSync(symlinkedEntry, `import { stringify } from './linked-src/utils/devalue';\nexport const out = stringify({ a: 1 });\n`);
  } catch {
    symlinkedEntry = undefined;
  }

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  async function bundle(entrypoint: string, target: 'browser' | 'bun'): Promise<{ code: string; inputs: string[] }> {
    const result = await Bun.build({ entrypoints: [entrypoint], target, plugins: [devalueAliasPlugin], metafile: true, throw: false });
    expect(result.success).toBe(true);
    const inputs = Object.keys(result.metafile?.inputs ?? {}).map((i) => toPosixPath(path.resolve(i)));
    const [output] = result.outputs;
    if (!output) {
      throw new Error('the build produced no output');
    }
    return { code: await output.text(), inputs };
  }

  for (const target of ['browser', 'bun'] as const) {
    test(`${target} builds hold the selected devalue and none of the dispatch`, async () => {
      const optimized = await bundle(entry, target);
      expect(optimized.code).not.toContain('getUseOptimizedDevalue');
      expect(optimized.inputs).not.toContain(SELECTOR);
      expect(optimized.inputs).toContain(VENDORED);

      setUseOptimizedDevalue(false);
      const plain = await bundle(entry, target);
      expect(plain.inputs).not.toContain(SELECTOR);
      expect(plain.inputs).toContain(devalueModulePath());
      expect(plain.inputs).not.toContain(VENDORED);
    });
  }

  test('a browser build pulls in no node builtins', async () => {
    const { code } = await bundle(entry, 'browser');
    expect(code).not.toContain('node:path');
    expect(code).not.toContain('node:fs');
    expect(code).not.toContain('Bun.resolveSync');
  });

  test.skipIf(!symlinkedEntry)('claims the selector reached through a symlinked framework directory', async () => {
    const { inputs } = await bundle(symlinkedEntry as string, 'bun');
    expect(inputs).not.toContain(SELECTOR);
    expect(inputs).toContain(VENDORED);
  });

  test('leaves a same-named module that is not the selector alone', async () => {
    const { code } = await bundle(entry, 'bun');
    expect(code).toContain('user-owned-devalue');
  });
});

describe('devalueErrorPath', () => {
  test('reads the path off either implementation', () => {
    for (const flag of [true, false]) {
      setUseOptimizedDevalue(flag);
      expect(() => stringify({ a: { b: () => undefined } })).toThrow();
      try {
        stringify({ a: { b: () => undefined } });
      } catch (e) {
        expect(devalueErrorPath(e)).toBe('.a.b');
      }
    }
  });

  test('reads it off a copy neither namespace here holds, which is what a compiled chunk carries', () => {
    class DevalueError extends Error {
      path = '.deep.inside';
      constructor() {
        super('Cannot stringify arbitrary non-POJOs');
        this.name = 'DevalueError';
      }
    }
    expect(devalueErrorPath(new DevalueError())).toBe('.deep.inside');
  });

  test('ignores anything that is not one', () => {
    expect(devalueErrorPath(new Error('nope'))).toBeUndefined();
    expect(devalueErrorPath({ name: 'DevalueError', path: '.a' })).toBeUndefined();
    expect(devalueErrorPath(undefined)).toBeUndefined();
  });
});
