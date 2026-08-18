import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { planFileReload } from './devWatcher';

describe('planFileReload', () => {
  const shared = path.resolve('/proj/src/plugin-list.ts');
  const serverEntryDeps = new Set([shared, path.resolve('/proj/src/index.ts')]);

  test('a .ts module in the server-entry graph reloads BOTH the entry and its pages', () => {
    // The regression: a module shared by src/index.ts and a page must recompile the page's SSR
    // bundle (page:true) as well as reloading the entry — the old exclusive dispatch dropped page.
    expect(planFileReload(shared, serverEntryDeps)).toEqual({ entry: true, page: true });
  });

  test('a .ts module outside the server-entry graph reloads only its pages', () => {
    const pageOnly = path.resolve('/proj/src/format.ts');
    expect(planFileReload(pageOnly, serverEntryDeps)).toEqual({ entry: false, page: true });
  });

  test('a .svelte file never triggers an entry reload, even when its path is in the entry graph', () => {
    const component = path.resolve('/proj/src/App.svelte');
    const withComponent = new Set([...serverEntryDeps, component]);
    expect(planFileReload(component, withComponent)).toEqual({ entry: false, page: true });
  });

  test('the entry-graph check resolves the changed path before matching', () => {
    const abs = path.resolve('helper.ts');
    expect(planFileReload('helper.ts', new Set([abs]))).toEqual({ entry: true, page: true });
  });
});
