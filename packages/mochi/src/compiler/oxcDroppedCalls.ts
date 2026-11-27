/**
 * oxc treats a fixed list of built-ins as pure and deletes a call whose result is unused, but coercing a `$state` proxy
 * is a read, so `String(items);` inside an `$effect` is a subscription that only Bun's minifier keeps.
 */
import { parse } from 'svelte/compiler';

// Measured against oxc-minify with `OXC_OPTIONS`: every global callable it deletes as a bare statement *and* that
// reads its argument. `oxcDroppedCalls.test.ts` re-derives both lists, so an oxc upgrade that changes them fails there.
const TO_STRING = ['String', 'parseInt', 'parseFloat', 'Number.parseInt', 'Number.parseFloat', 'Date.parse', 'Symbol.for', 'URL.canParse'];
const TO_STRING_URI = ['encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'escape'];
const TO_NUMBER = ['isNaN', 'isFinite', 'Date.UTC', 'String.fromCharCode', 'String.fromCodePoint'];
const MATH =
  'abs acos acosh asin asinh atan atan2 atanh cbrt ceil clz32 cos cosh exp expm1 floor fround hypot imul log log10 log1p log2 max min pow round sign sin sinh sqrt tan tanh trunc';

/** Maps each dropped call to the coercion it performs, which decides the replacement the warning suggests. */
export const OXC_DROPPED_CALLS: ReadonlyMap<string, 'string' | 'number'> = new Map([
  ...[...TO_STRING, ...TO_STRING_URI].map((name) => [name, 'string'] as const),
  ...[...TO_NUMBER, ...MATH.split(' ').map((m) => `Math.${m}`)].map((name) => [name, 'number'] as const),
]);

const REACTIVE_CALLBACKS = new Set(['$effect', '$effect.pre', '$derived.by']);

export interface OxcDroppedCall {
  line: number;
  /** The call as written, e.g. `String(filters)`. */
  call: string;
  callee: string;
  /** The identifier arguments, i.e. the values the effect stops reacting to. */
  values: string[];
  /** The rune whose callback contains the call. */
  rune: string;
}

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function dottedName(node: unknown): string | null {
  if (!isNode(node)) {
    return null;
  }
  if (node.type === 'Identifier') {
    return node.name as string;
  }
  if (node.type === 'MemberExpression' && !node.computed && isNode(node.object) && node.object.type === 'Identifier' && isNode(node.property)) {
    return `${node.object.name as string}.${node.property.name as string}`;
  }
  return null;
}

/** The expressions of a statement whose values are discarded: `a;`, each part of `a, b;`, and the operand of `void a;`. */
function discarded(expression: Node): Node[] {
  if (expression.type === 'SequenceExpression') {
    return (expression.expressions as Node[]).flatMap(discarded);
  }
  if (expression.type === 'UnaryExpression' && expression.operator === 'void') {
    return discarded(expression.argument as Node);
  }
  return [expression];
}

const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion']);

/** A cast is erased before oxc runs, so `String(x as string)` is as bare as `String(x)`. */
function unwrapTs(node: Node): Node {
  return TS_WRAPPERS.has(node.type) ? unwrapTs(node.expression as Node) : node;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scriptPrograms(source: string, filename: string): { program: Node; offset: number }[] {
  if (filename.endsWith('.svelte')) {
    const ast = parse(source, { modern: true, filename });
    return [ast.module, ast.instance].filter((s) => s != null).map((s) => ({ program: s.content as unknown as Node, offset: 0 }));
  }
  // Svelte's parser is the only TypeScript-aware one the framework ships, so a rune module borrows it through a script
  // tag; the prefix stays on line 1 so line numbers are unchanged.
  const prefix = `<script module${filename.endsWith('.ts') ? ' lang="ts"' : ''}>`;
  const ast = parse(`${prefix}${source}</scr` + `ipt>`, { modern: true, filename });
  return ast.module ? [{ program: ast.module.content as unknown as Node, offset: prefix.length }] : [];
}

/**
 * Bare calls in `source` that the oxc pass deletes from an `$effect`, `$effect.pre` or `$derived.by` callback. oxc only
 * deletes a call whose arguments are all plain identifiers or literals, and Svelte rewrites a reassigned `$state`, a
 * `$derived` or a prop to a call or property read, so `compiled` is checked for the call surviving in that plain form.
 */
export function findOxcDroppedCalls(source: string, filename: string, compiled: string): OxcDroppedCall[] {
  if (!/\$effect|\$derived\.by/.test(source)) {
    return [];
  }
  let programs: { program: Node; offset: number }[];
  try {
    programs = scriptPrograms(source, filename);
  } catch {
    // The compiler reports the real syntax error; a source only a user preprocessor can read is skipped.
    return [];
  }
  const found: OxcDroppedCall[] = [];
  for (const { program, offset } of programs) {
    const text = (node: Node) => source.slice(node.start - offset, node.end - offset);
    const check = (expression: Node, rune: string) => {
      const callee = expression.type === 'CallExpression' ? dottedName(expression.callee) : null;
      const args = ((expression.arguments ?? []) as Node[]).map(unwrapTs);
      const values = args.filter((a) => a.type === 'Identifier').map((a) => a.name as string);
      if (!callee || !OXC_DROPPED_CALLS.has(callee) || values.length === 0 || !args.every((a) => a.type === 'Identifier' || a.type === 'Literal')) {
        return;
      }
      const plainArgs = args.map((a) => (a.type === 'Identifier' ? `\\s*${escapeRegExp(a.name as string)}\\s*` : '[^,()]*')).join(',');
      if (!new RegExp(`(?<![\\w$.])${escapeRegExp(callee)}\\s*\\(${plainArgs}\\)`).test(compiled)) {
        return;
      }
      found.push({ line: source.slice(0, expression.start - offset).split('\n').length, call: text(expression), callee, values, rune });
    };
    const visit = (node: unknown, rune: string | null): void => {
      if (Array.isArray(node)) {
        for (const child of node) {
          visit(child, rune);
        }
        return;
      }
      if (!isNode(node)) {
        return;
      }
      if (rune && node.type === 'ExpressionStatement') {
        for (const expression of discarded(node.expression as Node)) {
          check(expression, rune);
        }
      }
      const calledRune = node.type === 'CallExpression' ? dottedName(node.callee) : null;
      const inner = calledRune && REACTIVE_CALLBACKS.has(calledRune) ? calledRune : rune;
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'loc' && typeof value === 'object') {
          visit(value, inner);
        }
      }
    };
    visit(program, null);
  }
  return found;
}

/** A statement that performs the same reads as the dropped call and survives oxc. */
export function oxcDroppedCallReplacement({ callee, values }: Pick<OxcDroppedCall, 'callee' | 'values'>): string {
  const coercion = OXC_DROPPED_CALLS.get(callee);
  return values.map((value) => (coercion === 'number' ? `Number(${value});` : `\`\${${value}}\`;`)).join(' ');
}

// Markdown's rule for code that itself contains a backtick, so the template literal reads unambiguously.
const code = (text: string) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);

export function formatOxcDroppedCall(file: string, dropped: OxcDroppedCall): string {
  const first = dropped.values[0]!;
  const target = dropped.rune === '$derived.by' ? 'derived' : 'effect';
  return (
    `${file}:${dropped.line} — \`${dropped.call}\` is a bare call inside ${dropped.rune}, and the 'oxc' minifier removes it, ` +
    `so the ${target} stops reacting to ${dropped.values.map((v) => `\`${v}\``).join(', ')}. ` +
    `Write ${code(oxcDroppedCallReplacement(dropped))} instead (same reads, survives oxc); ` +
    `\`JSON.stringify(${first});\`, \`$state.snapshot(${first});\` or a property read such as \`${first}.length;\` also work.`
  );
}
