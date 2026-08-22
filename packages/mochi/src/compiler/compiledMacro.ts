import MagicString from 'magic-string';
import { parse } from 'svelte/compiler';
import { freeIdentifiers } from './compiledScope';
import { evaluateTwin, CompiledExpressionError, type HostImport } from './compiledTwin';
import { serializeCompiledValue, type CompiledSerializer } from './compiledSerialize';
import { referencedNames } from './compiledReferences';
import { relForDisplay } from '../utils/index';

const MACRO_NAME = 'compiled';
const FRAMEWORK_SPECIFIER = 'mochi-framework';

/** Cheap gate so files without the macro never reach the parser, mirroring the directive fast-path in svelteAstPreprocess. */
export function mayContainCompiled(source: string): boolean {
  return source.includes(`${MACRO_NAME}(`);
}

export interface CompiledUsage {
  /** Project-relative path of the module the calls were found in. */
  file: string;
  count: number;
}

export interface CompiledTransformOptions {
  source: string;
  filePath: string;
  outDir: string;
  /** `.svelte` parses as a component; everything else is wrapped in a synthetic module script. */
  kind: 'svelte' | 'module';
  serializer?: CompiledSerializer;
  onUsage?: (usage: CompiledUsage) => void;
}

type Node = { type: string; start: number; end: number; [key: string]: unknown };

const MODULE_PREFIX = '<script module lang="ts">\n';
const MODULE_SUFFIX = `\n</${'script'}>`;

interface ScriptRegion {
  program: Node;
  /** Where generated imports go: just past the `<script>` open tag, which pruning never touches — anchoring them to the first import instead would delete them along with it. `null` for a plain module, whose imports are prepended to the result. */
  insertAt: number | null;
}

function scriptTagEnd(text: string, element: Node): number {
  return text.indexOf('>', element.start) + 1;
}

function parseRegions(source: string, kind: 'svelte' | 'module'): { text: string; regions: ScriptRegion[] } {
  if (kind === 'module') {
    const text = MODULE_PREFIX + source + MODULE_SUFFIX;
    const ast = parse(text, { modern: true }) as unknown as { module?: { content: Node } };
    return { text, regions: ast.module ? [{ program: ast.module.content, insertAt: null }] : [] };
  }
  const ast = parse(source, { modern: true }) as unknown as { instance?: Node; module?: Node };
  const regions: ScriptRegion[] = [];
  for (const element of [ast.module, ast.instance]) {
    if (element) {
      regions.push({ program: element.content as Node, insertAt: scriptTagEnd(source, element) });
    }
  }
  return { text: source, regions };
}

function importsOf(program: Node, text: string): HostImport[] {
  const out: HostImport[] = [];
  for (const stmt of (program.body as Node[]) ?? []) {
    if (stmt.type !== 'ImportDeclaration') {
      continue;
    }
    // Type-only imports are erased before anything runs, so they can neither feed nor block a macro.
    if (stmt.importKind === 'type') {
      continue;
    }
    const names: string[] = [];
    for (const spec of (stmt.specifiers as Node[]) ?? []) {
      if (spec.importKind === 'type') {
        continue;
      }
      names.push((spec.local as Node).name as string);
    }
    out.push({
      source: text.slice(stmt.start, stmt.end),
      specifier: (stmt.source as Node).value as string,
      names,
      start: stmt.start,
      end: stmt.end,
    });
  }
  return out;
}

interface MacroCall {
  call: Node;
  /** Range to overwrite. Covers an enclosing `await` when there is one — the inlined result is a plain literal, so keeping the `await` would force `experimental.async` on for no reason. */
  start: number;
  end: number;
}

/** Every `compiled(...)` call in a program, in source order, but only when `compiled` really is the framework import. */
function macroCalls(program: Node, imports: HostImport[]): MacroCall[] {
  const bound = imports.some((imp) => imp.specifier === FRAMEWORK_SPECIFIER && imp.names.includes(MACRO_NAME));
  if (!bound) {
    return [];
  }
  const calls: MacroCall[] = [];
  const visit = (node: unknown, parent: Node | null): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child, parent);
      }
      return;
    }
    const n = node as Node;
    if (typeof n.type !== 'string') {
      return;
    }
    if (n.type === 'CallExpression') {
      const callee = n.callee as Node | undefined;
      if (callee?.type === 'Identifier' && callee.name === MACRO_NAME) {
        const awaited = parent?.type === 'AwaitExpression' && parent.argument === n;
        calls.push({ call: n, start: awaited ? parent.start : n.start, end: awaited ? parent.end : n.end });
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key !== 'type' && key !== 'start' && key !== 'end') {
        visit(value, n);
      }
    }
  };
  visit(program.body, null);
  calls.sort((a, b) => a.start - b.start);
  return calls;
}

/**
 * Evaluate every `compiled()` call in a module at build time and inline the result.
 *
 * Returns the original source untouched when the file has no macro calls, so the common case costs one substring scan.
 */
export async function transformCompiled(opts: CompiledTransformOptions): Promise<string> {
  if (!mayContainCompiled(opts.source)) {
    return opts.source;
  }

  const { text, regions } = parseRegions(opts.source, opts.kind);
  const magic = new MagicString(text);
  const usedImports = new Set<HostImport>();
  const prepended: string[] = [];
  let count = 0;

  for (const region of regions) {
    const imports = importsOf(region.program, text);
    const calls = macroCalls(region.program, imports);
    for (const { call, start, end } of calls) {
      const args = (call.arguments as Node[]) ?? [];
      const expression = args[0];
      if (!expression) {
        throw new CompiledExpressionError(`compiled() needs a function argument, e.g. compiled(() => loadData()) — in ${relForDisplay(opts.filePath)}.`);
      }
      const expressionSource = text.slice(expression.start, expression.end);
      const free = freeIdentifiers(expression);
      const { value, used } = await evaluateTwin({
        hostPath: opts.filePath,
        expression: expressionSource,
        free,
        imports,
        outDir: opts.outDir,
      });
      for (const imp of used) {
        usedImports.add(imp);
      }
      const { expression: serialized, imports: refImports } = serializeCompiledValue(value, opts.serializer);
      const generated = refImports.map((r) => `import ${r.identifier} from ${JSON.stringify(r.specifier)};`).join('\n');
      magic.overwrite(start, end, serialized);
      if (generated) {
        if (region.insertAt === null) {
          prepended.push(generated);
        } else {
          magic.appendLeft(region.insertAt, `\n${generated}`);
        }
      }
      count++;
    }
    // The macro import itself only ever exists to be erased.
    for (const imp of imports) {
      if (imp.specifier === FRAMEWORK_SPECIFIER && imp.names.some((n) => n === MACRO_NAME || n === 'moduleRef')) {
        usedImports.add(imp);
      }
    }
  }

  if (count === 0) {
    return opts.source;
  }

  pruneDeadImports(magic, text, usedImports, opts.kind);

  if (opts.kind === 'module') {
    // Strip the synthetic wrapper through MagicString rather than slicing the output by prefix length: inserted
    // imports have already shifted every index by then.
    magic.remove(0, MODULE_PREFIX.length);
    magic.remove(text.length - MODULE_SUFFIX.length, text.length);
  }
  opts.onUsage?.({ file: relForDisplay(opts.filePath), count });
  const body = magic.toString();
  return prepended.length > 0 ? `${prepended.join('\n')}\n${body}` : body;
}

/**
 * Drop imports that only fed a now-inlined expression.
 *
 * This is load-bearing rather than cosmetic: a module like a Shiki-backed highlighter has top-level side effects, so
 * the bundler will not tree-shake it away on its own and the whole dependency would still ship. Pruning is deliberately
 * one-directional — a name still referenced anywhere else, including in Svelte markup, keeps its import.
 */
function pruneDeadImports(magic: MagicString, text: string, candidates: Set<HostImport>, kind: 'svelte' | 'module'): void {
  if (candidates.size === 0) {
    return;
  }
  const referenced = referencedNames(magic.toString(), kind);
  for (const imp of candidates) {
    // A bare `import './side-effects.ts'` binds nothing and is never ours to remove.
    if (imp.names.length === 0) {
      continue;
    }
    if (imp.names.some((name) => referenced.has(name))) {
      continue;
    }
    // Swallow the declaration's own trailing newline so pruning leaves no blank line behind.
    const trailing = text.startsWith('\n', imp.end) ? 1 : 0;
    magic.remove(imp.start, imp.end + trailing);
  }
}
