import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { ComponentRegistry, type ComponentRegistryOptions } from './ComponentRegistry';
import type { BarrelMetafile } from './barrelDetect';
import { logger } from '../utils/log';

// Registry-glue coverage for the barrel warning: detection itself is unit-tested
// in barrelDetect.test.ts, but the dev/build branching here is wrapped in a
// swallow-everything try/catch, so a wiring regression would vanish silently
// without these.

const BARREL = 'node_modules/somebarrel/dist/index.js';

function metafile(bytes = 100 * 1024): BarrelMetafile {
  return {
    inputs: { [BARREL]: { bytes } },
    outputs: { 'out.js': { inputs: { [BARREL]: { bytesInOutput: 0 } } } },
  };
}

function makeRegistry(opts: ComponentRegistryOptions = {}): ComponentRegistry {
  return new ComponentRegistry({ development: false, ...opts });
}

function detect(registry: ComponentRegistry, mf: BarrelMetafile): void {
  registry['warnOnBarrelImports'](mf);
}

const warnSpy = spyOn(logger, 'warn').mockImplementation(() => {});

afterEach(() => {
  warnSpy.mockClear();
});

describe('warnOnBarrelImports', () => {
  test('a live server logs immediately, once per package, and flush stays a no-op', () => {
    const registry = makeRegistry();
    detect(registry, metafile());
    detect(registry, metafile());
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('somebarrel');

    // Nothing was buffered, so the build-only flush must not double-report.
    registry.flushBarrelWarnings();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('a buffering (build-mode) registry stays silent until flush, then emits one grouped summary', () => {
    const registry = makeRegistry({ bufferBarrelWarnings: true });
    detect(registry, metafile());
    expect(warnSpy).not.toHaveBeenCalled();

    registry.flushBarrelWarnings();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('1 heavy barrel import');

    registry.flushBarrelWarnings();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('barrelWarnings: false disables detection entirely', () => {
    const registry = makeRegistry({ barrelWarnings: false });
    detect(registry, metafile());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('an explicit minBytes: 0 is honored instead of falling back to the 50 KB default', () => {
    const registry = makeRegistry({ barrelWarnings: { minBytes: 0 } });
    detect(registry, metafile(1024));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
