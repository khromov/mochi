import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'svelte/compiler';
import MagicString from 'magic-string';
import { relForDisplay, toPosixPath } from '../utils';

/**
 * Resolves the framework's own public components (`mochi-framework/components`) to the on-disk `.svelte` files they
 * re-export, bridging the barrel's named exports to the relative paths the island preprocessor understands — so a
 * `mochi:*` directive can sit straight on a package import (`<MochiCaptcha mochi:hydrate />`).
 *
 * The mapping is read from the actual barrel next to this file rather than a hardcoded list, so it can't drift from what
 * a given `mochi-framework` version ships, in-repo through a workspace symlink or from a consumer's `node_modules`.
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
  // Svelte's own acorn-typescript parser yields a real AST where pattern-matching the source would guess: wrapping the
  // barrel in a module script makes its `export { … } from '…'` re-exports parse as `ExportNamedDeclaration` nodes. Per
  // specifier, `local` is the export name in the source file and `exported` the name the barrel exposes.
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

/** Resolve a `mochi-framework/components` named export to its underlying file, or `null` for a typo or non-component export, which falls through to the usual unresolved-island compile error. */
export function resolveFrameworkComponent(exportName: string): FrameworkComponent | null {
  cache ??= parseBarrel();
  return cache.get(exportName) ?? null;
}

/** Svelte's AST nodes all have start/end, but estree types don't declare them. */
interface Positioned {
  start: number;
  end: number;
}

/**
 * Replaces `mochi-framework/components` imports with direct imports of the underlying component files, so a client
 * bundle only carries the components actually imported — the barrel co-locates SSR-only components (`ViewTransitions`,
 * `RawScript`) with hydratable ones (`MochiCaptcha`), and without this split the unused ones ride into client chunks
 * as dead code (nothing declares `sideEffects`, so the bundler keeps every re-export live). Client build only; the
 * barrel is correct server-side. Throws on shapes it can't split (namespace/default imports, re-exports, unknown
 * names) — the client build surfaces the message as a build error rather than silently re-bloating.
 */
export function rewriteFrameworkComponentImports(source: string, filePath: string): string {
  if (!source.includes(FRAMEWORK_COMPONENTS_SPECIFIER)) {
    return source;
  }
  const ast = parse(source, { modern: true });
  const s = new MagicString(source);
  let changed = false;
  for (const script of [ast.instance, ast.module]) {
    for (const node of script?.content.body ?? []) {
      if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value === FRAMEWORK_COMPONENTS_SPECIFIER) {
        throw new Error(
          `[mochi] ${relForDisplay(filePath)}: re-exporting from "${FRAMEWORK_COMPONENTS_SPECIFIER}" can't be split for the client bundle — import the components and re-export them individually.`,
        );
      }
      if (node.type !== 'ImportDeclaration' || node.source.value !== FRAMEWORK_COMPONENTS_SPECIFIER) {
        continue;
      }
      const lines: string[] = [];
      for (const spec of node.specifiers ?? []) {
        if (spec.type !== 'ImportSpecifier') {
          throw new Error(
            `[mochi] ${relForDisplay(filePath)}: only named imports of "${FRAMEWORK_COMPONENTS_SPECIFIER}" can be split for the client bundle — rewrite this ${spec.type === 'ImportNamespaceSpecifier' ? 'namespace' : 'default'} import as named imports.`,
          );
        }
        const name = specifierName(spec.imported);
        const framework = resolveFrameworkComponent(name);
        if (!framework) {
          throw new Error(`[mochi] ${relForDisplay(filePath)}: "${name}" is not a component exported by "${FRAMEWORK_COMPONENTS_SPECIFIER}".`);
        }
        const target = toPosixPath(framework.resolvedPath);
        lines.push(
          framework.exportName === 'default'
            ? `import ${spec.local.name} from "${target}";`
            : `import { ${JSON.stringify(framework.exportName)} as ${spec.local.name} } from "${target}";`,
        );
      }
      const pos = node as unknown as Positioned;
      s.overwrite(pos.start, pos.end, lines.join('\n'));
      changed = true;
    }
  }
  return changed ? s.toString() : source;
}
