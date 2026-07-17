import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'svelte/compiler';

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

/** An export/import specifier name is an Identifier or, rarely, a string literal. */
function specifierName(node: { type: string; name?: string; value?: unknown }): string {
  return node.type === 'Identifier' ? node.name! : String(node.value);
}

function parseBarrel(): Map<string, FrameworkComponent> {
  const map = new Map<string, FrameworkComponent>();
  let source: string;
  try {
    source = fs.readFileSync(BARREL_PATH, 'utf8');
  } catch {
    return map;
  }
  const barrelDir = path.dirname(BARREL_PATH);
  // Reuse Svelte's own (acorn-typescript) parser for a real AST instead of
  // pattern-matching the source: wrap the barrel in a module script so its
  // `export { … } from '…'` re-exports parse as `ExportNamedDeclaration` nodes.
  // For each specifier, `local` is the export name in the source file
  // (`default` for `export { default as X }`) and `exported` is the name the
  // barrel — and therefore a `mochi-framework/components` import — exposes.
  const ast = parse(`<script module lang="ts">\n${source}\n</script>`, { modern: true });
  for (const node of ast.module?.content.body ?? []) {
    if (node.type !== 'ExportNamedDeclaration' || !node.source || typeof node.source.value !== 'string') {
      continue;
    }
    if (!/\.(svelte|md|svx)$/.test(node.source.value)) {
      continue;
    }
    const resolvedPath = path.resolve(barrelDir, node.source.value);
    for (const spec of node.specifiers) {
      if (spec.type !== 'ExportSpecifier') {
        continue;
      }
      map.set(specifierName(spec.exported), { resolvedPath, exportName: specifierName(spec.local) });
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
