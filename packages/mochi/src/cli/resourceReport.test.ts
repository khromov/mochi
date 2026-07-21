import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectImageResources, collectScriptResources, collectStyleResources } from './resourceReport';
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
    expect(rows).toEqual([{ name: 'hero-abc.png', detail: '1400×807', bytes: 1234 }]);
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
    expect(collectImageResources([gone])).toEqual([{ name: 'gone.png', detail: '1×1', bytes: 0 }]);
  });

  test('no assets yields no rows', () => {
    expect(collectImageResources([])).toEqual([]);
  });
});

/** Writes `bytes` bytes and returns the disk path the manifest would point at. */
function emitted(name: string, bytes: number): string {
  const dir = dirs.at(-1) ?? mkdtempSync(join(tmpdir(), 'mochi-resreport-'));
  if (!dirs.includes(dir)) {
    dirs.push(dir);
  }
  const diskPath = join(dir, name);
  writeFileSync(diskPath, new Uint8Array(bytes));
  return diskPath;
}

const MISSING = join(tmpdir(), 'mochi-resreport-nope', 'gone');

describe('collectStyleResources', () => {
  test('lists import-css entries and folds per-component styles into one aggregate row', () => {
    const clientFiles = {
      '/_mochi/import-css/full-abc.css': emitted('full-abc.css', 900),
      '/_mochi/import-css/inter-def.css': emitted('inter-def.css', 100),
      '/_mochi/css/Like-xyz.css': emitted('Like-xyz.css', 300),
      '/_mochi/css/Nav-xyz.css': emitted('Nav-xyz.css', 200),
      '/_mochi/client/_hydrate-Like-xyz.js': emitted('_hydrate-Like-xyz.js', 5000),
    };
    // The aggregate is pinned above the individual bundles, not ranked by size.
    expect(collectStyleResources(clientFiles, '/_mochi')).toEqual([
      { name: 'component styles (2 files)', bytes: 500, glyph: '◇', files: 2 },
      { name: 'full-abc.css', bytes: 900 },
      { name: 'inter-def.css', bytes: 100 },
    ]);
  });

  test('honors a custom asset prefix', () => {
    const clientFiles = { '/assets/import-css/full-abc.css': emitted('full-abc.css', 42) };
    expect(collectStyleResources(clientFiles, '/assets')).toEqual([{ name: 'full-abc.css', bytes: 42 }]);
    expect(collectStyleResources(clientFiles, '/_mochi')).toEqual([]);
  });

  test('a stylesheet missing from disk is listed at zero rather than throwing', () => {
    expect(collectStyleResources({ '/_mochi/import-css/gone.css': MISSING }, '/_mochi')).toEqual([{ name: 'gone.css', bytes: 0 }]);
  });
});

describe('collectScriptResources', () => {
  const entryUrls = { Like_abc: '/_mochi/client/_hydrate-Like_abc-1.js', Nav_def: '/_mochi/client/_hydrate-Nav_def-2.js' };
  const bootstrap = '/_mochi/client/HydratableIsland-x.js';

  function files() {
    return {
      '/_mochi/client/_hydrate-Like_abc-1.js': emitted('_hydrate-Like_abc-1.js', 900),
      '/_mochi/client/_hydrate-Nav_def-2.js': emitted('_hydrate-Nav_def-2.js', 300),
      '/_mochi/client/HydratableIsland-x.js': emitted('HydratableIsland-x.js', 120),
      '/_mochi/client/chunk-one.js': emitted('chunk-one.js', 500),
      '/_mochi/client/chunk-two.js': emitted('chunk-two.js', 100),
      '/_mochi/css/Like-xyz.css': emitted('Like-xyz.css', 4000),
    };
  }

  test('lists island entries and the bootstrap, aggregating the shared chunks', () => {
    expect(collectScriptResources(files(), '/_mochi', entryUrls, bootstrap)).toEqual([
      { name: 'shared chunks (2 files)', bytes: 600, glyph: '◇', files: 2 },
      { name: '_hydrate-Like_abc-1.js', bytes: 900 },
      { name: '_hydrate-Nav_def-2.js', bytes: 300 },
      { name: 'HydratableIsland-x.js', bytes: 120 },
    ]);
  });

  test('an island used under several names is sized once, not per name', () => {
    const shared = { Like_abc: entryUrls.Like_abc, LikeAgain_abc: entryUrls.Like_abc };
    const rows = collectScriptResources(files(), '/_mochi', shared, null);
    expect(rows.filter((r) => r.name === '_hydrate-Like_abc-1.js')).toHaveLength(1);
    // With no bootstrap and Nav unclaimed, both fall into the chunk aggregate.
    expect(rows).toContainEqual({ name: 'shared chunks (4 files)', bytes: 1020, glyph: '◇', files: 4 });
  });

  test('a script missing from disk is listed at zero rather than throwing', () => {
    expect(collectScriptResources({ '/_mochi/client/gone.js': MISSING }, '/_mochi', { Gone: '/_mochi/client/gone.js' }, null)).toEqual([{ name: 'gone.js', bytes: 0 }]);
  });
});
