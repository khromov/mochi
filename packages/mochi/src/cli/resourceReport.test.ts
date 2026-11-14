import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectFontResources, collectImageResources, mergeResourceRows } from './resourceReport';
import type { LocalImageAsset } from '../image/types';

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

describe('collectFontResources', () => {
  test('reports the emitted filename and size, with a font symbol and no dimensions', () => {
    const { diskPath } = asset('inter-latin-400-normal-ab12cd34.woff2', 9000);
    const rows = collectFontResources([{ diskPath }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'inter-latin-400-normal-ab12cd34.woff2', dimensions: '—', bytes: 9000 });
    expect(rows[0]!.symbol).toContain('ƒ');
  });

  test('a font missing from disk is listed at zero rather than throwing', () => {
    const rows = collectFontResources([{ diskPath: join(tmpdir(), 'mochi-resreport-nope', 'gone.woff2') }]);
    expect(rows[0]).toMatchObject({ name: 'gone.woff2', bytes: 0 });
  });
});

describe('mergeResourceRows', () => {
  test('interleaves images and fonts largest first', () => {
    const images = collectImageResources([asset('big.png', 500), asset('small.png', 10)]);
    const fonts = collectFontResources([{ diskPath: asset('mid-1234abcd.woff2', 100).diskPath }]);
    expect(mergeResourceRows(images, fonts).map((r) => r.name)).toEqual(['big.png', 'mid-1234abcd.woff2', 'small.png']);
  });
});
