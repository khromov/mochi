import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { logger } from '../utils/log';

const FIXTURES = path.join(import.meta.dir, '..', '__fixtures__', 'ssr-only-island');

describe('.server.svelte inside islands', () => {
  const outDirs: string[] = [];
  const makeRegistry = () => {
    const outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ssr-only-island-'));
    outDirs.push(outDir);
    return new ComponentRegistry({ development: false, outDir });
  };
  afterAll(() => {
    for (const dir of outDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a mochi:hydrate directive on one is a compile error', async () => {
    const registry = makeRegistry();
    const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});
    try {
      await registry.compile(path.join(FIXTURES, 'PageDirect.svelte'));
    } finally {
      errorSpy.mockRestore();
    }

    const errors = registry.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe('server-only-island');
    expect(errors[0]).toMatchObject({ component: 'Changelog', directive: 'mochi:hydrate' });
  });

  test('one rendered deeper inside a hydrated island builds with a retained-stub warning', async () => {
    const registry = makeRegistry();
    const warnSpy = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await registry.compile(path.join(FIXTURES, 'PageNested.svelte'));

      expect(registry.getErrors()).toHaveLength(0);
      const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(warned).toContain('Changelog.server.svelte');
      expect(warned).toContain('throw at hydration');
      expect(warned).not.toContain('\\');
    } finally {
      warnSpy.mockRestore();
    }

    // The retained stub keeps its (nonzero) bytes visible in the client stats the debug panel reads.
    const stats = registry.getClientStats();
    const stubInputs = (stats?.outputs ?? []).flatMap((o) => o.inputs ?? []).filter((i) => i.path.includes('mochi-ssr-only-component:'));
    expect(stubInputs.length).toBeGreaterThan(0);
    expect(stubInputs.some((i) => i.size > 0)).toBe(true);
    // The server body itself still never ships.
    const joined = [...registry.getClientFiles().values()].join('\n');
    expect(joined).not.toContain('readFileSync');
  });
});
