/**
 * `useOptimizedDevalue` has no observable effect on output — that is the whole point — so what has to be tested is
 * the wiring: that the selector and the generated `mochi-env` modules both move to the other implementation, and
 * that they move together.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { devalueModulePath, getUseOptimizedDevalue, parse, setUseOptimizedDevalue, stringify } from './utils/devalue';
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
