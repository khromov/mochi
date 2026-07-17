import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves the framework's own public components (`mochi-framework/components`)
 * to the on-disk `.svelte` files they re-export, so a `mochi:*` directive can
 * sit directly on a package import (`<MochiCaptcha mochi:hydrate />`) with no
 * local wrapper — the island preprocessor only knows how to resolve relative
 * paths, and this bridges the barrel's named exports to those paths.
 *
 * The mapping is read from the *actual* barrel next to this file rather than a
 * hardcoded list, so it can never drift from what a given `mochi-framework`
 * version ships — whether resolved in-repo (workspace symlink) or from
 * `node_modules` in a published consumer.
 */

/** The specifier a directive may target to reach a framework component. */
export const FRAMEWORK_COMPONENTS_SPECIFIER = 'mochi-framework/components';

// This file lives in `src/compiler/`; the barrel is `src/components/index.ts`.
const BARREL_PATH = path.join(path.dirname(Bun.fileURLToPath(import.meta.url)), '..', 'components', 'index.ts');

export interface FrameworkComponent {
  /** Absolute path to the underlying `.svelte`/`.md`/`.svx` file. */
  resolvedPath: string;
  /** Export the underlying module is imported from (`'default'` for `export { default as X }`). */
  exportName: string;
}

// The barrel is static within a process (the framework doesn't change under a
// running build), so parse it once and reuse.
let cache: Map<string, FrameworkComponent> | null = null;

function parseBarrel(): Map<string, FrameworkComponent> {
  const map = new Map<string, FrameworkComponent>();
  let source: string;
  try {
    source = fs.readFileSync(BARREL_PATH, 'utf8');
  } catch {
    return map;
  }
  const barrelDir = path.dirname(BARREL_PATH);
  // Matches the barrel's controlled re-export forms, capturing the binding and
  // its source: `export { default as Name } from '…'`, `export { Orig as Name }
  // from '…'`, and `export { Name } from '…'`.
  const re = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const [, clause, spec] of source.matchAll(re)) {
    if (!clause || !spec || !/\.(svelte|md|svx)$/.test(spec)) {
      continue;
    }
    const resolvedPath = path.resolve(barrelDir, spec);
    for (const raw of clause.split(',')) {
      const binding = raw.trim();
      if (!binding) {
        continue;
      }
      const asMatch = binding.match(/^(\S+)\s+as\s+(\S+)$/);
      if (asMatch) {
        const [, orig, local] = asMatch;
        map.set(local!, { resolvedPath, exportName: orig === 'default' ? 'default' : orig! });
      } else {
        map.set(binding, { resolvedPath, exportName: binding });
      }
    }
  }
  return map;
}

/**
 * Resolve a `mochi-framework/components` named export to its underlying file, or
 * `null` if the barrel exports no such component (a typo or a non-component
 * export — left to fall through to the normal unresolved-island compile error).
 */
export function resolveFrameworkComponent(exportName: string): FrameworkComponent | null {
  cache ??= parseBarrel();
  return cache.get(exportName) ?? null;
}
