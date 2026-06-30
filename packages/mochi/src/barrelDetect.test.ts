import { describe, expect, test } from 'bun:test';
import { detectHeavyBarrels, formatBarrelLine, formatBarrelSummary, formatUsedRatio, type BarrelMetafile, type HeavyBarrel } from './barrelDetect';

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

describe('formatUsedRatio', () => {
  test('renders 0 for a fully tree-shaken barrel', () => {
    expect(formatUsedRatio(0)).toBe('0%');
  });

  test('renders a floor marker for tiny non-zero ratios', () => {
    expect(formatUsedRatio(0.0004)).toBe('<0.1%'); // 0.04%
  });

  test('renders one decimal for normal ratios', () => {
    expect(formatUsedRatio(0.042)).toBe('4.2%');
    expect(formatUsedRatio(0.5)).toBe('50.0%');
  });
});

describe('formatBarrelLine', () => {
  test('names the package, KB, and the real used percentage', () => {
    const b: HeavyBarrel = { pkg: '@lucide/svelte', file: '@lucide/svelte/dist/icons/index.js', bytes: 108457, usedRatio: 0 };
    const line = formatBarrelLine(b);
    expect(line).toContain('"@lucide/svelte"');
    expect(line).toContain('(106 KB)');
    expect(line).toContain('uses only 0% of it');
    expect(line).not.toContain('~none');
  });
});

describe('formatBarrelSummary', () => {
  const mk = (pkg: string, kb: number, usedRatio = 0): HeavyBarrel => ({ pkg, file: `${pkg}/index.js`, bytes: kb * 1024, usedRatio });

  test('counts offenders, totals KB, and lists the top three', () => {
    const summary = formatBarrelSummary([mk('a', 100), mk('b', 50), mk('c', 25)]);
    expect(summary).toContain('3 heavy barrel imports');
    expect(summary).toContain('(175 KB total)');
    expect(summary).toContain('Worst: a (100 KB, 0% used), b (50 KB, 0% used), c (25 KB, 0% used)');
    expect(summary).not.toContain('more');
  });

  test('singularizes and appends a "+N more" tail past three', () => {
    const summary = formatBarrelSummary([mk('a', 100), mk('b', 50), mk('c', 25), mk('d', 10), mk('e', 10)]);
    expect(summary).toContain(', +2 more.');

    expect(formatBarrelSummary([mk('solo', 80)])).toContain('1 heavy barrel import ');
  });
});
