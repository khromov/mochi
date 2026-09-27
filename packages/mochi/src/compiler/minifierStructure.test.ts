// A minifier may rename and re-print, but never change a chunk's module interface. oxc is handed one already-split
// chunk at a time, so every browser-facing output is built both ways and compared on that interface.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { buildDebugBarBundle } from './buildDebugBarBundle';
import { buildInlineWebComponent } from './buildInlineWebComponent';
import { resolveSvelteCompiler } from './svelteCompilerBackend';
import { logicalName, moduleShape, type ModuleShape } from '../__fixtures__/minifier-structure/moduleShape';

const PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'minifier-structure', 'Page.svelte');

let outDirs: string[] = [];
let savedEnv: string | undefined;

async function clientChunks(minifier: 'bun' | 'oxc'): Promise<[string, string][]> {
  const outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', `.mochi-minifier-structure-${minifier}-`));
  outDirs.push(outDir);
  const registry = new ComponentRegistry({ development: false, debugBar: false, outDir, minifier });
  await registry.compileAll([PAGE]);
  return [...registry.getClientFiles()].filter(([url]) => url.endsWith('.js')).map(([url, code]) => [path.basename(url), code]);
}

const named = (chunks: [string, string][]) => new Map(chunks.filter(([n]) => logicalName(n) !== 'chunk').map(([n, c]) => [logicalName(n), moduleShape(n, c)]));
const shared = (chunks: [string, string][]) =>
  chunks
    .filter(([n]) => logicalName(n) === 'chunk')
    .map(([n, c]) => JSON.stringify(moduleShape(n, c)))
    .sort();

let bun: [string, string][];
let oxc: [string, string][];

describe('bun and oxc emit the same module interface', () => {
  beforeAll(async () => {
    // This file picks both modes itself; an inherited MOCHI_MINIFIER would turn the 'bun' side into oxc.
    savedEnv = process.env.MOCHI_MINIFIER;
    delete process.env.MOCHI_MINIFIER;
    bun = await clientChunks('bun');
    oxc = await clientChunks('oxc');
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.MOCHI_MINIFIER = savedEnv;
    }
    for (const dir of outDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    outDirs = [];
  });

  test('the fixture exercises shared chunks, cross-chunk imports and a dynamic import', () => {
    const shapes = bun.map(([n, c]) => moduleShape(n, c));
    expect(shared(bun).length).toBeGreaterThan(0);
    expect(shapes.some((s) => s.staticImports.some((i) => i.source.startsWith('<chunk#')))).toBe(true);
    expect(shapes.some((s) => s.dynamicImports.length > 0)).toBe(true);
  });

  test('named entries pair up one-to-one with identical imports and exports', () => {
    const bunNamed = named(bun);
    const oxcNamed = named(oxc);
    expect([...oxcNamed.keys()].sort()).toEqual([...bunNamed.keys()].sort());
    for (const [name, shape] of bunNamed) {
      expect({ name, shape: oxcNamed.get(name) }).toEqual({ name, shape });
    }
  });

  test('shared chunks match as a multiset of shapes', () => {
    expect(shared(oxc)).toEqual(shared(bun));
  });

  test.each(['./web-components/ServerIsland.ts', './web-components/LiveReload.ts'])('inline %s keeps its classic-script shape', async (entry) => {
    const shape = async (m: 'bun' | 'oxc') => moduleShape(path.basename(entry), await buildInlineWebComponent(entry, m), 'script');
    const expected: ModuleShape = await shape('bun');
    expect(await shape('oxc')).toEqual(expected);
  });

  test.each([false, true])('debug bar (development: %p) keeps its shape', async (development) => {
    const backend = await resolveSvelteCompiler();
    const [bunBar, oxcBar] = [await buildDebugBarBundle({ development, backend, minifier: 'bun' }), await buildDebugBarBundle({ development, backend, minifier: 'oxc' })];
    expect(moduleShape(oxcBar.fileName, oxcBar.contents)).toEqual(moduleShape(bunBar.fileName, bunBar.contents));
  });
});
