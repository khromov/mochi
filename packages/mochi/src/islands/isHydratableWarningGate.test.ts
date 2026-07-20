import { afterAll, beforeAll, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';
import { logger } from '../utils/log';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'island-context-unused', 'Page.svelte');

describe('seed-decline warning gate', () => {
  let outDir: string;
  let warnSpy: Mock<typeof logger.warn>;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-context-unused-'));
    warnSpy = spyOn(logger, 'warn');
    await new ComponentRegistry({ development: true, outDir }).compileAll([FIXTURE_PAGE]);
  });

  afterAll(() => {
    warnSpy.mockRestore();
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a declined hydrating island root stays silent when nothing in the build calls isHydratable()', () => {
    const warned = warnSpy.mock.calls.flat().some((a) => typeof a === 'string' && a.includes('isHydratable() could not be wired up'));
    expect(warned).toBe(false);
  });
});
