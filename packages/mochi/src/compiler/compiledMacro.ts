import MagicString from 'magic-string';
import { parse } from 'svelte/compiler';
import { walk } from 'zimmerframe';
import { freeIdentifiers, hoistedNames } from './compiledScope';
import { evaluateTwin, CompiledExpressionError, type HostImport } from './compiledTwin';
import { serializeCompiledValue, createCompiledRefScope } from './compiledSerialize';
import { relForDisplay, toPosixPath } from '../utils/index';

const MACRO_NAME = 'compiled';
const FRAMEWORK_SPECIFIER = 'mochi-framework';

/** Cheap gate so files without the macro never reach the parser, mirroring the directive fast-path in svelteAstPreprocess. */
const MACRO_CALL_PATTERN = new RegExp(String.raw`(^|[^\w$.])${MACRO_NAME}\s*\(`);

export function mayContainCompiled(source: string): boolean {
  return MACRO_CALL_PATTERN.test(source);
}

export interface CompiledUsage {
  /** Absolute path of the module the calls were found in; the build report renders it project-relative. */
  file: string;
  count: number;
}

export interface CompiledTransformOptions {
  source: string;
  filePath: string;
  outDir: string;
  /** `.svelte` parses as a component; everything else is wrapped in a synthetic module script. */
  kind: 'svelte' | 'module';
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

const SCRIPT_CLOSE = new RegExp(String.raw`</scr` + `ipt`, 'gi');

/** The replacement is the same length as what it blunts, so every AST offset still lines up with the real text the transform slices from. */
function neutralizeScriptClose(text: string): string {
  return text.slice(0, text.length - MODULE_SUFFIX.length).replace(SCRIPT_CLOSE, '<%scr' + 'ipt') + MODULE_SUFFIX;
}

/** A plain module is wrapped in a synthetic `<script module>` so the Svelte parser serves both kinds, and the wrapper is stripped again at the end of the transform. */
function parseRegions(source: string, kind: 'svelte' | 'module'): { text: string; regions: ScriptRegion[]; fragment?: Node } {
  if (kind === 'module') {
    const text = MODULE_PREFIX + source + MODULE_SUFFIX;
    const ast = parse(neutralizeScriptClose(text), { modern: true }) as unknown as { module?: { content: Node } };
    return { text, regions: ast.module ? [{ program: ast.module.content, insertAt: null }] : [] };
  }
  const ast = parse(source, { modern: true }) as unknown as { instance?: Node; module?: Node; fragment?: Node };
  const regions: ScriptRegion[] = [];
  for (const element of [ast.module, ast.instance]) {
    if (element) {
      const program = element.content as Node;
      regions.push({ program, insertAt: program.start });
    }
  }
  return { text: source, regions, fragment: ast.fragment };
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

function macroCalls(root: Node | undefined): MacroCall[] {
  const calls: MacroCall[] = [];
  if (!root) {
    return calls;
  }
  walk(root, null, {
    CallExpression(node, { next, path }) {
      const callee = node.callee as Node;
      if (callee.type === 'Identifier' && callee.name === MACRO_NAME) {
        const parent = path.at(-1);
        const awaited = parent?.type === 'AwaitExpression';
        if (!awaited && parent?.type === 'MemberExpression' && parent.object === node) {
          throw new CompiledExpressionError(
            'compiled() must be awaited directly, as in: await compiled(() => loadData()). The call is replaced by the value it returned, so chaining off the promise it appears to return cannot work.',
          );
        }
        calls.push({ call: node, start: awaited ? parent.start : node.start, end: awaited ? parent.end : node.end });
      }
      next();
    },
  });
  return calls.sort((a, b) => a.start - b.start);
}

/** Read off the AST rather than the text because an inlined value is often source code itself, and a textual scan would match inside it and never prune anything. */
function referencedNames(roots: (Node | undefined)[], calls: MacroCall[]): Set<string> {
  const names = new Set<string>();
  for (const root of roots) {
    if (!root) {
      continue;
    }
    walk(root, null, {
      _(node, { next }) {
        if (node.type === 'ImportDeclaration' || calls.some((c) => c.start <= node.start && node.end <= c.end)) {
          return;
        }
        if (node.type === 'Identifier') {
          names.add(node.name as string);
        } else if (node.type === 'Component') {
          // `<Foo.Bar />` in markup keeps the `Foo` import alive.
          names.add((node.name as string).split('.')[0]!);
        }
        next();
      },
    });
  }
  return names;
}

/** Returns the original source untouched when the file has no macro calls, so the common case costs one substring scan. */
export async function transformCompiled(opts: CompiledTransformOptions): Promise<string> {
  if (!mayContainCompiled(opts.source)) {
    return opts.source;
  }

  const { text, regions, fragment } = parseRegions(opts.source, opts.kind);
  // Only script regions are transformed, so a call in markup would fall through to the runtime shim and quietly ship the dependency the macro exists to erase.
  if (macroCalls(fragment).length > 0) {
    throw new CompiledExpressionError(
      'compiled() only works inside a script block, but ' +
        relForDisplay(opts.filePath) +
        ' calls it from markup. Move the call into the component script and reference the result.',
    );
  }
  const magic = new MagicString(text);
  const candidates = new Set<HostImport>();
  const allCalls: MacroCall[] = [];
  const prepended: string[] = [];
  const refScope = createCompiledRefScope();

  for (const region of regions) {
    const imports = importsOf(region.program, text);
    const bound = imports.some((imp) => imp.specifier === FRAMEWORK_SPECIFIER && imp.names.includes(MACRO_NAME));
    const calls = bound ? macroCalls(region.program) : [];
    const hostLocals = hoistedNames(region.program.body);
    for (const { call, start, end } of calls) {
      const expression = ((call.arguments as Node[]) ?? [])[0];
      if (!expression) {
        throw new CompiledExpressionError(`compiled() needs a function argument, e.g. compiled(() => loadData()) — in ${relForDisplay(opts.filePath)}.`);
      }
      const { value, used } = await evaluateTwin({
        hostPath: opts.filePath,
        expression: text.slice(expression.start, expression.end),
        free: freeIdentifiers(expression),
        imports,
        hostLocals,
        outDir: opts.outDir,
      });
      for (const imp of used) {
        candidates.add(imp);
      }
      const { expression: serialized, imports: refImports } = serializeCompiledValue(value, refScope);
      const generated = refImports.map((r) => `import ${r.identifier} from ${JSON.stringify(r.specifier)};`).join('\n');
      magic.overwrite(start, end, serialized);
      if (generated) {
        if (region.insertAt === null) {
          prepended.push(generated);
        } else {
          magic.appendLeft(region.insertAt, `\n${generated}`);
        }
      }
    }
    allCalls.push(...calls);
    // The macro import itself only ever exists to be erased.
    for (const imp of imports) {
      if (imp.specifier === FRAMEWORK_SPECIFIER && imp.names.some((n) => n === MACRO_NAME || n === 'moduleRef')) {
        candidates.add(imp);
      }
    }
  }

  if (allCalls.length === 0) {
    return opts.source;
  }

  pruneDeadImports(magic, text, candidates, referencedNames([...regions.map((r) => r.program), fragment], allCalls));

  if (opts.kind === 'module') {
    // Strip the synthetic wrapper through MagicString rather than slicing the output by prefix length: inserted
    // imports have already shifted every index by then.
    magic.remove(0, MODULE_PREFIX.length);
    magic.remove(text.length - MODULE_SUFFIX.length, text.length);
  }
  opts.onUsage?.({ file: toPosixPath(opts.filePath), count: allCalls.length });
  const body = magic.toString();
  return prepended.length > 0 ? `${prepended.join('\n')}\n${body}` : body;
}

/** Load-bearing rather than cosmetic: a module like a Shiki-backed highlighter has top-level side effects, so the bundler will not tree-shake it away on its own. */
function pruneDeadImports(magic: MagicString, text: string, candidates: Set<HostImport>, referenced: Set<string>): void {
  for (const imp of candidates) {
    // A bare `import './side-effects.ts'` binds nothing and is never ours to remove.
    if (imp.names.length === 0 || imp.names.some((name) => referenced.has(name))) {
      continue;
    }
    // Take the declaration's own indentation and line ending too, or pruning leaves an orphaned blank line behind.
    const lineStart = text.lastIndexOf('\n', imp.start - 1) + 1;
    const start = text.slice(lineStart, imp.start).trim() === '' ? lineStart : imp.start;
    let end = imp.end;
    if (text.startsWith('\r\n', end)) {
      end += 2;
    } else if (text.startsWith('\n', end)) {
      end += 1;
    }
    magic.remove(start, end);
  }
}
