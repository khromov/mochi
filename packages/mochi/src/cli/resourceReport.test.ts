import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectImageResources, printChunkTree } from './resourceReport';
import type { LocalImageAsset } from '../image/types';

/** Runs `fn` with console.log captured, returning everything it printed. */
function captureLog(fn: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** Writes `bytes` bytes to `name` and returns the asset the loader would have registered. */
function asset(name: string, bytes: number, dims: { width: number; height: number } = { width: 40, height: 30 }): LocalImageAsset {
  const dir = dirs.at(-1) ?? mkdtempSync(join(tmpdir(), 'mochi-resreport-'));
  if (!dirs.includes(dir)) {
    dirs.push(dir);
  }
  const diskPath = join(dir, name);
  writeFileSync(diskPath, new Uint8Array(bytes));
  return { src: `/_mochi/asset/${name}`, diskPath, contentType: 'image/png', format: 'png', ...dims };
}

describe('collectImageResources', () => {
  test('reports the emitted filename, dimensions and size on disk', () => {
    const rows = collectImageResources([asset('hero-abc.png', 1234, { width: 1400, height: 807 })]);
    expect(rows).toEqual([{ name: 'hero-abc.png', dimensions: '1400×807', bytes: 1234 }]);
  });

  test('sorts largest first, breaking ties by name', () => {
    const rows = collectImageResources([asset('b-2.png', 10), asset('big.png', 500), asset('a-2.png', 10)]);
    expect(rows.map((r) => r.name)).toEqual(['big.png', 'a-2.png', 'b-2.png']);
  });

  test('an asset missing from disk is listed at zero rather than throwing', () => {
    const gone: LocalImageAsset = {
      src: '/_mochi/asset/gone.png',
      diskPath: join(tmpdir(), 'mochi-resreport-nope', 'gone.png'),
      contentType: 'image/png',
      format: 'png',
      width: 1,
      height: 1,
    };
    expect(collectImageResources([gone])).toEqual([{ name: 'gone.png', dimensions: '1×1', bytes: 0 }]);
  });

  test('no assets yields no rows', () => {
    expect(collectImageResources([])).toEqual([]);
  });
});

describe('printChunkTree', () => {
  const row = (chunkNames: string[], bytes = 1000, modules = 3) => ({ chunkNames, modules, bytes });

  test('prints a row per chunk with its total', () => {
    const out = captureLog(() => printChunkTree([row(['vendor'], 2048)], []));
    expect(out).toContain('Chunk');
    expect(out).toContain('vendor');
    expect(out).toContain('1 chunk');
  });

  test('names both groups when two of them land in one output', () => {
    const out = captureLog(() => printChunkTree([row(['charts', 'vendor'])], []));
    expect(out).toContain('charts + vendor');
  });

  // A column header with nothing under it reads as a broken report.
  test('omits the table entirely when there are no chunks to list', () => {
    const out = captureLog(() => printChunkTree([], [{ id: 'src/a.ts', reason: 'CommonJS' }], ['vendor']));
    expect(out).not.toContain('Chunk');
    expect(out).toContain('left in place: src/a.ts');
    expect(out).toContain('no shared chunk: vendor');
  });

  test('prints nothing at all when there is nothing to report', () => {
    expect(captureLog(() => printChunkTree([], []))).toBe('');
  });
});
