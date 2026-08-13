import MagicString from 'magic-string';
import ts from 'typescript';
import type { SpeculationRules } from '../runtime/speculationRules';

/** Raised when the entry can't be safely edited; the CLI prints the rules so the user can paste them by hand. */
export class SpeculationRulesWriteError extends Error {
  constructor(
    message: string,
    readonly code: 'no-serve' | 'non-literal-arg',
  ) {
    super(message);
    this.name = 'SpeculationRulesWriteError';
  }
}

export interface WriteSpeculationRulesResult {
  action: 'inserted' | 'replaced';
  multipleServeCalls: boolean;
}

function isMochiServeCall(node: ts.Node): node is ts.CallExpression {
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
  const source = await Bun.file(entryPath).text();
  const sf = ts.createSourceFile(entryPath, source, ts.ScriptTarget.Latest, true);

  const serveCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (isMochiServeCall(node)) {
      serveCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (serveCalls.length === 0) {
    throw new SpeculationRulesWriteError(`No \`Mochi.serve({ ... })\` call found in ${entryPath}.`, 'no-serve');
  }

  const literalCall = serveCalls.find((call) => call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0]));
  if (!literalCall) {
    throw new SpeculationRulesWriteError(
      `\`Mochi.serve()\` in ${entryPath} is not called with an inline object literal, so the \`speculationRules\` key can't be inserted automatically. Add it by hand.`,
      'non-literal-arg',
    );
  }

  const obj = literalCall.arguments[0] as ts.ObjectLiteralExpression;

  const indent =
    obj.properties.length > 0
      ? ' '.repeat(sf.getLineAndCharacterOfPosition(obj.properties[0]!.getStart(sf)).character)
      : ' '.repeat(sf.getLineAndCharacterOfPosition(obj.getStart(sf)).character + 2);

  const serialized = JSON.stringify(rules, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : indent + line))
    .join('\n');

  const magic = new MagicString(source);
  const existing = obj.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'speculationRules');

  let action: WriteSpeculationRulesResult['action'];
  if (existing) {
    magic.overwrite(existing.getStart(sf), existing.getEnd(), `speculationRules: ${serialized}`);
    action = 'replaced';
  } else {
    magic.appendLeft(obj.getStart(sf) + 1, `\n${indent}speculationRules: ${serialized},`);
    action = 'inserted';
  }

  await Bun.write(entryPath, magic.toString());
  return { action, multipleServeCalls: serveCalls.length > 1 };
}
