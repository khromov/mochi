// isCompiled() backs the server-island manifest-miss warning in Mochi.ts (see
// serverIslandManifestMiss.test.ts) — it must agree with evict()'s notion of
// "known" (exact key, or a differently-formatted path resolving to the same
// file) so the warning doesn't fire for paths that are actually compiled.
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

  test('true when the stored key resolves to the same path even if written differently', () => {
    const registry = new ComponentRegistry({ development: true });
    // Mirrors compileAll(), which keys compiledComponents by the caller's
    // original filename string (possibly relative), not path.resolve()'d.
    seed(registry, './project/src/Known.svelte');
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
