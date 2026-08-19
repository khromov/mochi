import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { isServerEntryDep, moduleStateReloadWarning } from './devWatcher';

describe('isServerEntryDep', () => {
  const shared = path.resolve('/proj/src/plugin-list.ts');
  const serverEntryDeps = new Set([shared, path.resolve('/proj/src/index.ts')]);

  test('a .ts module in the server-entry graph is an entry dep (its change rebuilds the entry)', () => {
    // The regression this guards: such a module must go through triggerEntryReload, which rebuilds the entry AND
    // recompiles any page whose SSR bundle inlines it. The old exclusive dispatch sent it to only one of the two.
    expect(isServerEntryDep(shared, serverEntryDeps)).toBe(true);
  });

  test('a .ts module outside the server-entry graph is not an entry dep', () => {
    const pageOnly = path.resolve('/proj/src/format.ts');
    expect(isServerEntryDep(pageOnly, serverEntryDeps)).toBe(false);
  });

  test('a .svelte file is never an entry dep, even when its path is in the entry graph', () => {
    const component = path.resolve('/proj/src/App.svelte');
    const withComponent = new Set([...serverEntryDeps, component]);
    expect(isServerEntryDep(component, withComponent)).toBe(false);
  });

  test('the check resolves the changed path before matching', () => {
    const abs = path.resolve('helper.ts');
    expect(isServerEntryDep('helper.ts', new Set([abs]))).toBe(true);
  });
});

describe('moduleStateReloadWarning', () => {
  test('stays silent below the threshold', () => {
    expect(moduleStateReloadWarning(9)).toBeNull();
  });

  test('warns exactly at the threshold and names the fix', () => {
    const warning = moduleStateReloadWarning(10);
    expect(warning).toContain('pinGlobal');
    expect(warning).toContain('10');
  });

  test('stays silent past the threshold, so it fires once', () => {
    expect(moduleStateReloadWarning(11)).toBeNull();
    expect(moduleStateReloadWarning(50)).toBeNull();
  });

  test('honours a custom threshold', () => {
    expect(moduleStateReloadWarning(3, 3)).toContain('pinGlobal');
    expect(moduleStateReloadWarning(2, 3)).toBeNull();
  });
});
