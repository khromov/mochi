import MagicString from 'magic-string';
import type * as TSApi from 'typescript';
import type { SpeculationRules } from '../runtime/speculationRules';

type TsModule = typeof import('typescript');

/** Raised when the entry can't be safely edited; the CLI prints the rules so the user can paste them by hand. */
export class SpeculationRulesWriteError extends Error {
  constructor(
    message: string,
    readonly code: 'no-serve' | 'non-literal-arg' | 'no-typescript',
  ) {
    super(message);
    this.name = 'SpeculationRulesWriteError';
  }
}

export interface WriteSpeculationRulesResult {
  action: 'inserted' | 'replaced';
  multipleServeCalls: boolean;
}

// `typescript` is only a devDependency, so load it lazily and fail with a paste-friendly message when a consumer
// doesn't have it — keeping the other CLI commands free of any typescript requirement.
async function loadTs(): Promise<TsModule> {
  try {
    const mod = await import('typescript');
    return (mod.default ?? mod) as TsModule;
  } catch {
    throw new SpeculationRulesWriteError(
      'The `speculation-rules` command needs the `typescript` package to edit your entry. Install it (e.g. `bun add -d typescript`) or add the `speculationRules` key by hand.',
      'no-typescript',
    );
  }
}

function isMochiServeCall(ts: TsModule, node: TSApi.Node): node is TSApi.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  return node.expression.name.text === 'serve' && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Mochi';
}

/**
 * Insert (or overwrite) a `speculationRules` key inside the entry's `Mochi.serve({ ... })` object literal, editing the
 * source in place with magic-string so the rest of the file's formatting is untouched. Throws a
 * {@link SpeculationRulesWriteError} when the serve call is missing or is passed a non-literal argument.
 */
export async function writeSpeculationRules(entryPath: string, rules: SpeculationRules): Promise<WriteSpeculationRulesResult> {
  const ts = await loadTs();
  const source = await Bun.file(entryPath).text();
  const sf = ts.createSourceFile(entryPath, source, ts.ScriptTarget.Latest, true);

  const serveCalls: TSApi.CallExpression[] = [];
  const visit = (node: TSApi.Node): void => {
    if (isMochiServeCall(ts, node)) {
      serveCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (serveCalls.length === 0) {
    throw new SpeculationRulesWriteError(`No \`Mochi.serve({ ... })\` call found in ${entryPath}.`, 'no-serve');
  }

  const literalCalls = serveCalls.filter((call): call is TSApi.CallExpression => !!call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0]));
  if (literalCalls.length === 0) {
    throw new SpeculationRulesWriteError(
      `\`Mochi.serve()\` in ${entryPath} is not called with an inline object literal, so the \`speculationRules\` key can't be inserted automatically. Add it by hand.`,
      'non-literal-arg',
    );
  }

  const obj = literalCalls[0]!.arguments[0] as TSApi.ObjectLiteralExpression;

  const indent =
    obj.properties.length > 0
      ? ' '.repeat(sf.getLineAndCharacterOfPosition(obj.properties[0]!.getStart(sf)).character)
      : ' '.repeat(sf.getLineAndCharacterOfPosition(obj.getStart(sf)).character + 2);

  const serialized = JSON.stringify(rules, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : indent + line))
    .join('\n');

  const magic = new MagicString(source);
  const existing = obj.properties.find((p): p is TSApi.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'speculationRules');

  let action: WriteSpeculationRulesResult['action'];
  if (existing) {
    magic.overwrite(existing.getStart(sf), existing.getEnd(), `speculationRules: ${serialized}`);
    action = 'replaced';
  } else {
    magic.appendLeft(obj.getStart(sf) + 1, `\n${indent}speculationRules: ${serialized},`);
    action = 'inserted';
  }

  await Bun.write(entryPath, magic.toString());
  return { action, multipleServeCalls: literalCalls.length > 1 };
}
