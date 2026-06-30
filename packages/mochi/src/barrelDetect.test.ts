import { describe, expect, test } from 'bun:test';
import { detectHeavyBarrels, type BarrelMetafile } from './barrelDetect';

const LUCIDE_INDEX = '../../node_modules/.bun/@lucide+svelte@1.21.0+hash/node_modules/@lucide/svelte/dist/icons/index.js';
const LUCIDE_ICON = '../../node_modules/.bun/@lucide+svelte@1.21.0+hash/node_modules/@lucide/svelte/dist/icons/sun.svelte';

// Mirrors the real `@lucide/svelte` barrel build: the 108 KB re-export index is
// parsed but tree-shaken to 0 bytes; only the used icon survives.
function barrelMetafile(): BarrelMetafile {
  return {
    inputs: {
      'src/Page.svelte': { bytes: 500 },
      [LUCIDE_INDEX]: { bytes: 108457 },
      [LUCIDE_ICON]: { bytes: 1594 },
    },
    outputs: {
      'Page-abc.js': {
        inputs: {
          'src/Page.svelte': { bytesInOutput: 500 },
          [LUCIDE_INDEX]: { bytesInOutput: 0 },
          [LUCIDE_ICON]: { bytesInOutput: 47 },
        },
      },
    },
  };
}

describe('detectHeavyBarrels', () => {
  const MIN = 50 * 1024;

  test('flags a large node_modules input that is tree-shaken to ~nothing', () => {
    const found = detectHeavyBarrels(barrelMetafile(), MIN, new Set());
    expect(found).toEqual([{ pkg: '@lucide/svelte', file: '@lucide/svelte/dist/icons/index.js', bytes: 108457, usedRatio: 0 }]);
  });

  test('does not flag a large dependency that is genuinely used', () => {
    const mf = barrelMetafile();
    mf.outputs['Page-abc.js']!.inputs![LUCIDE_INDEX]!.bytesInOutput = 100000; // ~92% used
    expect(detectHeavyBarrels(mf, MIN, new Set())).toEqual([]);
  });

  test('ignores inputs under the byte threshold', () => {
    const mf = barrelMetafile();
    mf.inputs[LUCIDE_INDEX]!.bytes = 1000; // below 50 KB even though 0% used
    expect(detectHeavyBarrels(mf, MIN, new Set())).toEqual([]);
  });

  test('respects the per-package ignore set', () => {
    expect(detectHeavyBarrels(barrelMetafile(), MIN, new Set(['@lucide/svelte']))).toEqual([]);
  });

  test('extracts unscoped package names', () => {
    const mf: BarrelMetafile = {
      inputs: { 'node_modules/somebarrel/dist/index.js': { bytes: 200000 } },
      outputs: { 'out.js': { inputs: { 'node_modules/somebarrel/dist/index.js': { bytesInOutput: 10 } } } },
    };
    const found = detectHeavyBarrels(mf, MIN, new Set());
    expect(found).toHaveLength(1);
    expect(found[0]!.pkg).toBe('somebarrel');
  });

  test('ignores app source files regardless of size', () => {
    const mf: BarrelMetafile = {
      inputs: { 'src/Huge.svelte': { bytes: 999999 } },
      outputs: { 'out.js': { inputs: { 'src/Huge.svelte': { bytesInOutput: 0 } } } },
    };
    expect(detectHeavyBarrels(mf, MIN, new Set())).toEqual([]);
  });
});
