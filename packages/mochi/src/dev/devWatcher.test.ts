import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { isServerEntryDep, isStructuralChange, reachedModuleChurnThreshold, reconcileOptimizedDevalue } from './devWatcher';
import { getUseOptimizedDevalue, setUseOptimizedDevalue } from '../utils/devalue';

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

  // The regression this guards: only a successful build populates the dep set, so a failed one used to send every
  // later entry edit down the plain-recompile path — route HMR stayed dead for the rest of the dev session.
  test('with no successful entry build yet, any non-.svelte change retries it', () => {
    expect(isServerEntryDep('src/index.ts', new Set(), false)).toBe(true);
    expect(isServerEntryDep('src/App.svelte', new Set(), false)).toBe(false);
  });
});

describe('reachedModuleChurnThreshold', () => {
  test('is false below the threshold', () => {
    expect(reachedModuleChurnThreshold(9)).toBe(false);
  });

  test('is true exactly at the threshold', () => {
    expect(reachedModuleChurnThreshold(10)).toBe(true);
  });

  test('is false past the threshold, so the warning fires once', () => {
    expect(reachedModuleChurnThreshold(11)).toBe(false);
    expect(reachedModuleChurnThreshold(50)).toBe(false);
  });

  test('honours a custom threshold', () => {
    expect(reachedModuleChurnThreshold(3, 3)).toBe(true);
    expect(reachedModuleChurnThreshold(2, 3)).toBe(false);
  });
});

describe('isStructuralChange', () => {
  test('an added or removed source or data file may change a directory listing a prerendered module reads', () => {
    expect(isStructuralChange('add', 'packages/docs/180-new.md')).toBe(true);
    expect(isStructuralChange('unlink', 'src/demos/x/Card.svelte')).toBe(true);
    expect(isStructuralChange('add', 'src/data/rows.json')).toBe(true);
  });

  test('an edit reaches its dependents through the import graph instead', () => {
    expect(isStructuralChange('change', 'packages/docs/180-new.md')).toBe(false);
  });

  test('editor temp files, dotfiles, and directories never count', () => {
    expect(isStructuralChange('add', 'src/.Page.svelte.swp')).toBe(false);
    expect(isStructuralChange('add', 'src/4913')).toBe(false);
    expect(isStructuralChange('add', 'src/Page.svelte___jb_tmp___')).toBe(false);
    expect(isStructuralChange('add', 'src/.DS_Store')).toBe(false);
    expect(isStructuralChange('addDir', 'src/new-folder')).toBe(false);
    expect(isStructuralChange('unlinkDir', 'src/old-folder')).toBe(false);
  });
});

describe('reconcileOptimizedDevalue', () => {
  afterEach(() => {
    setUseOptimizedDevalue(true);
  });

  test('an unset option means the default, which is no change', () => {
    expect(reconcileOptimizedDevalue(undefined)).toBe(false);
    expect(getUseOptimizedDevalue()).toBe(true);
  });

  test('turning it off applies, and reports the change that forces a rebundle', () => {
    expect(reconcileOptimizedDevalue(false)).toBe(true);
    expect(getUseOptimizedDevalue()).toBe(false);
  });

  test('an unrelated entry edit re-reports the same value without churning every page', () => {
    reconcileOptimizedDevalue(false);
    expect(reconcileOptimizedDevalue(false)).toBe(false);
  });

  test('turning it back on applies too — the flag is not one-way', () => {
    reconcileOptimizedDevalue(false);
    expect(reconcileOptimizedDevalue(true)).toBe(true);
    expect(getUseOptimizedDevalue()).toBe(true);
  });
});
