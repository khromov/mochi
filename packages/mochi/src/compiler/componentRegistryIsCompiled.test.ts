// isCompiled() reports whether a component came out of the prebuilt manifest,
// so it must agree with evict() on what "known" means and must not care how the
// caller spelled the path — a relative registration and its absolute form are
// the same component.
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

interface RegistryInternals {
  compiledComponents: Map<string, { module: { default: unknown }; cssComponents: Set<string>; hydratables: []; ssrPath: string }>;
}

function seed(registry: ComponentRegistry, key: string): void {
  (registry as unknown as RegistryInternals).compiledComponents.set(key, {
    module: { default: undefined },
    cssComponents: new Set(),
    hydratables: [],
    ssrPath: '/dev/null',
  });
}

describe('ComponentRegistry.isCompiled', () => {
  test('false for a path that was never compiled', () => {
    const registry = new ComponentRegistry({ development: true });
    expect(registry.isCompiled('/project/src/Missing.svelte')).toBe(false);
  });

  test('true once the exact key has an entry', () => {
    const registry = new ComponentRegistry({ development: true });
    const absPath = path.resolve('/project/src/Known.svelte');
    seed(registry, absPath);
    expect(registry.isCompiled(absPath)).toBe(true);
  });

  test('a relative and an absolute spelling are the same component', () => {
    const registry = new ComponentRegistry({ development: true });
    seed(registry, path.resolve('./project/src/Known.svelte'));
    expect(registry.isCompiled('./project/src/Known.svelte')).toBe(true);
    expect(registry.isCompiled(path.resolve('./project/src/Known.svelte'))).toBe(true);
  });

  test('false again after evict()', () => {
    const registry = new ComponentRegistry({ development: true });
    const absPath = path.resolve('/project/src/Known.svelte');
    seed(registry, absPath);
    registry.evict(absPath);
    expect(registry.isCompiled(absPath)).toBe(false);
  });
});
