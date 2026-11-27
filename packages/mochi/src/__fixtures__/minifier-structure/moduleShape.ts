/**
 * The module interface of one emitted chunk: what a minifier may never change, even though it may rename every local
 * binding and re-print every expression. oxc sees one already-split chunk at a time, so this is where it could break.
 */
import path from 'node:path';
import { parseSync } from 'oxc-parser';

export interface ModuleShape {
  staticImports: { source: string; names: string[] }[];
  sideEffectImports: string[];
  exportNames: string[];
  starReexports: string[];
  dynamicImports: string[];
  importMetaCount: number;
  topLevelAwait: boolean;
  directives: string[];
}

/** Drops Bun's `[hash]` and the oxc tag, which differ by design between the two modes. */
export function logicalName(fileName: string): string {
  return path.basename(fileName).replace(/-[a-z0-9]+(?:-o[0-9a-f]{8})?\.js$/, '');
}

export function moduleShape(fileName: string, code: string, sourceType: 'module' | 'script' = 'module'): ModuleShape {
  const parsed = parseSync(fileName, code, { sourceType });
  const fatal = parsed.errors.filter((e) => e.severity === 'Error');
  if (fatal.length > 0) {
    throw new Error(`${fileName}: parse failed as ${sourceType} — ${fatal[0]!.message}`);
  }
  const mod = parsed.module;
  // Shared `chunk-*` files have no logical name, so each is renumbered by first appearance within this file.
  const chunkAlias = new Map<string, string>();
  const source = (raw: string): string => {
    const name = logicalName(raw);
    if (name !== 'chunk') {
      return raw.includes('/') ? `<entry:${name}>` : raw;
    }
    if (!chunkAlias.has(raw)) {
      chunkAlias.set(raw, `<chunk#${chunkAlias.size}>`);
    }
    return chunkAlias.get(raw)!;
  };

  const staticImports: ModuleShape['staticImports'] = [];
  const sideEffectImports: string[] = [];
  for (const imp of mod.staticImports) {
    if (imp.entries.length === 0) {
      sideEffectImports.push(source(imp.moduleRequest.value));
      continue;
    }
    // Imported names, not local ones, sorted: only the order of import statements is observable, not of specifiers.
    staticImports.push({
      source: source(imp.moduleRequest.value),
      names: imp.entries.map((e) => (e.importName.kind === 'Name' ? `name:${e.importName.name}` : e.importName.kind)).sort(),
    });
  }

  const exportNames: string[] = [];
  const starReexports: string[] = [];
  for (const exp of mod.staticExports) {
    for (const entry of exp.entries) {
      if (entry.importName.kind === 'AllButDefault' || entry.importName.kind === 'All') {
        starReexports.push(`${entry.importName.kind}:${entry.moduleRequest ? source(entry.moduleRequest.value) : ''}`);
        continue;
      }
      const from = entry.moduleRequest ? `<-${source(entry.moduleRequest.value)}` : '';
      exportNames.push(`${entry.exportName.kind === 'None' ? 'default' : (entry.exportName.name ?? 'default')}${from}`);
    }
  }

  // `dynamicImports` carries offsets only; a computed specifier has no literal and is recorded as `<expr>`.
  const dynamicImports = mod.dynamicImports.map((d) => {
    const raw = code.slice(d.moduleRequest.start, d.moduleRequest.end);
    return /^["'`]/.test(raw) ? source(raw.slice(1, -1)) : '<expr>';
  });

  const directives: string[] = [];
  for (const node of parsed.program.body) {
    const directive = (node as { directive?: string }).directive;
    if (directive === undefined) {
      break;
    }
    directives.push(directive);
  }

  return {
    staticImports,
    sideEffectImports,
    exportNames: exportNames.sort(),
    starReexports: starReexports.sort(),
    dynamicImports,
    importMetaCount: mod.importMetas.length,
    topLevelAwait: hasTopLevelAwait(parsed.program.body),
    directives,
  };
}

const NESTED_SCOPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression', 'ClassBody']);

function hasTopLevelAwait(node: unknown): boolean {
  if (node === null || typeof node !== 'object') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(hasTopLevelAwait);
  }
  const type = (node as { type?: string }).type;
  if (type && NESTED_SCOPES.has(type)) {
    return false;
  }
  if (type === 'AwaitExpression' || (type === 'ForOfStatement' && (node as { await?: boolean }).await === true)) {
    return true;
  }
  return Object.entries(node).some(([key, value]) => key !== 'type' && key !== 'start' && key !== 'end' && hasTopLevelAwait(value));
}
