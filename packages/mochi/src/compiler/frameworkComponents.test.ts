import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { resolveFrameworkComponent } from './frameworkComponents';

// The public components the barrel re-exports, as an independent oracle: each
// must resolve to the right on-disk file and export. Add a line here when a
// component joins `mochi-framework/components` — the mismatch is the point.
const EXPECTED: Record<string, { endsWith: string; exportName: string }> = {
  ViewTransitions: { endsWith: path.join('components', 'ViewTransitions.server.svelte'), exportName: 'default' },
  RawScript: { endsWith: path.join('components', 'RawScript.server.svelte'), exportName: 'default' },
  MochiCaptcha: { endsWith: path.join('captcha', 'MochiCaptcha.svelte'), exportName: 'default' },
};

describe('resolveFrameworkComponent', () => {
  test.each(Object.entries(EXPECTED))('%s resolves to the expected file and export', (_name, expected) => {
    const resolved = resolveFrameworkComponent(_name);
    expect(resolved).not.toBeNull();
    expect(resolved!.exportName).toBe(expected.exportName);
    expect(resolved!.resolvedPath.endsWith(expected.endsWith)).toBe(true);
    // Drift guard: the resolved path is a real component file, not a stale name.
    expect(fs.existsSync(resolved!.resolvedPath)).toBe(true);
  });

  test('an unknown export resolves to null', () => {
    expect(resolveFrameworkComponent('NotAComponent')).toBeNull();
  });
});
