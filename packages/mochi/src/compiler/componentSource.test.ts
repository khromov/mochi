import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { resolveComponentPath } from './componentSource';

// A `.svelte` import is a stub function tagged by the preload plugin, so a plain object stands in for one here.
function stub(source: string): never {
  return { __source: source } as never;
}

describe('resolveComponentPath', () => {
  test('passes a path string through untouched', () => {
    expect(resolveComponentPath('./src/Home.svelte', 'Mochi.page()')).toBe('./src/Home.svelte');
  });

  test('resolves a tagged component to a cwd-relative path', () => {
    const resolved = resolveComponentPath(stub(path.join(process.cwd(), 'src', 'Home.svelte')), 'Mochi.page()');
    expect(resolved).toBe('./src/Home.svelte');
    expect(resolved).not.toContain('\\');
  });

  test('keeps a relative prefix for sources above the project root', () => {
    const resolved = resolveComponentPath(stub(path.join(process.cwd(), '..', 'shared', 'Home.svelte')), 'Mochi.page()');
    expect(resolved).toBe('../shared/Home.svelte');
    expect(resolved).not.toContain('\\');
  });

  test('names the label and the preload fix when the source tag is missing', () => {
    expect(() => resolveComponentPath((() => {}) as never, 'errorPage')).toThrow(/errorPage.*mochi-framework\/plugin/s);
  });
});
