import MagicString from 'magic-string';
import type * as TSApi from 'typescript';
import { relForDisplay } from '../utils';
import type { SpeculationRules } from '../runtime/speculationRules';

type TsModule = typeof import('typescript');

/** Raised when the entry can't be safely edited; the CLI prints the rules so the user can paste them by hand. */
export class SpeculationRulesWriteError extends Error {
  constructor(
    message: string,
    readonly code: 'no-serve' | 'non-literal-arg' | 'unresolved-value' | 'no-typescript',
  ) {
    super(message);
    this.name = 'SpeculationRulesWriteError';
  }
}

export interface WriteSpeculationRulesResult {
  action: 'inserted' | 'replaced';
  multipleServeCalls: boolean;
}

function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || (err instanceof Error && /Cannot find (module|package)/.test(err.message));
}

// `typescript` is only a devDependency, so load it lazily and fail with a paste-friendly message when a consumer
// doesn't have it — keeping the other CLI commands free of any typescript requirement.
async function loadTs(): Promise<TsModule> {
  try {
    const mod = await import('typescript');
    return (mod.default ?? mod) as TsModule;
  } catch (err) {
    // Only a genuinely absent package gets the install hint; anything else (broken install, interop failure) surfaces as-is.
    if (!isModuleNotFound(err)) {
      throw err;
    }
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

/** The static name of an object member, or `undefined` for a spread or a key computed at runtime. */
function memberName(ts: TsModule, member: TSApi.ObjectLiteralElementLike): string | undefined {
  const name = member.name;
  if (!name) {
    return undefined;
  }
  if (ts.isComputedPropertyName(name)) {
    return ts.isStringLiteralLike(name.expression) ? name.expression.text : undefined;
  }
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

/** A key only known at runtime could be `speculationRules`, which would make an inserted key a silent duplicate. */
function hasDynamicKey(ts: TsModule, obj: TSApi.ObjectLiteralExpression): boolean {
  return obj.properties.some((p) => !!p.name && ts.isComputedPropertyName(p.name) && !ts.isStringLiteralLike(p.name.expression));
}

/** Locate a same-file `const x = { … }` so a `speculationRules` key given by reference is rewritten at its source. */
function findVariableInitializer(ts: TsModule, sf: TSApi.SourceFile, name: string): TSApi.ObjectLiteralExpression | undefined {
  let found: TSApi.ObjectLiteralExpression | undefined;
  const visit = (node: TSApi.Node): void => {
    if (!found && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Insert (or overwrite) a `speculationRules` key inside the entry's `Mochi.serve({ ... })` object literal, editing the
 * source in place with magic-string so the rest of the file's formatting is untouched. A key supplied by reference
 * (`speculationRules,` or `speculationRules: rules`) is rewritten at the variable it points to, so the edit takes effect
 * rather than shadowing it. Throws a {@link SpeculationRulesWriteError} when the serve call is missing, is passed a
 * non-literal argument, or names a value this file can't reach.
 */
export async function writeSpeculationRules(entryPath: string, rules: SpeculationRules): Promise<WriteSpeculationRulesResult> {
  const ts = await loadTs();
  const rel = relForDisplay(entryPath) || entryPath;
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
    throw new SpeculationRulesWriteError(`No \`Mochi.serve({ ... })\` call found in ${rel}.`, 'no-serve');
  }

  const literalCalls = serveCalls.filter((call): call is TSApi.CallExpression => !!call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0]));
  if (literalCalls.length === 0) {
    throw new SpeculationRulesWriteError(
      `\`Mochi.serve()\` in ${rel} is not called with an inline object literal, so the \`speculationRules\` key can't be inserted automatically. Add it by hand.`,
      'non-literal-arg',
    );
  }

  const obj = literalCalls[0]!.arguments[0] as TSApi.ObjectLiteralExpression;
  if (hasDynamicKey(ts, obj)) {
    throw new SpeculationRulesWriteError(
      `The \`Mochi.serve()\` object in ${rel} has a computed key, so a \`speculationRules\` key can't be inserted without risking a duplicate. Add it by hand.`,
      'unresolved-value',
    );
  }

  const indentOf = (node: TSApi.Node): string => ' '.repeat(sf.getLineAndCharacterOfPosition(node.getStart(sf)).character);
  const serialize = (indent: string): string =>
    JSON.stringify(rules, null, 2)
      .split('\n')
      .map((line, i) => (i === 0 ? line : indent + line))
      .join('\n');

  const magic = new MagicString(source);
  const existing = obj.properties.find((p) => memberName(ts, p) === 'speculationRules');

  let action: WriteSpeculationRulesResult['action'];
  if (existing && ts.isPropertyAssignment(existing) && !ts.isIdentifier(existing.initializer)) {
    magic.overwrite(existing.initializer.getStart(sf), existing.initializer.getEnd(), serialize(indentOf(existing)));
    action = 'replaced';
  } else if (existing) {
    // Shorthand (`speculationRules,`) or a reference (`speculationRules: rules`) — rewrite the value where it is declared.
    const refName = ts.isPropertyAssignment(existing) ? (existing.initializer as TSApi.Identifier).text : (existing.name as TSApi.Identifier).text;
    const target = findVariableInitializer(ts, sf, refName);
    if (!target) {
      throw new SpeculationRulesWriteError(
        `\`speculationRules\` in ${rel} is set from \`${refName}\`, which isn't an object literal declared in this file, so it can't be updated automatically. Edit it by hand.`,
        'unresolved-value',
      );
    }
    const statement = ts.isVariableDeclarationList(target.parent.parent) ? target.parent.parent.parent : target.parent;
    magic.overwrite(target.getStart(sf), target.getEnd(), serialize(indentOf(statement)));
    action = 'replaced';
  } else {
    // Appended last so a spread earlier in the literal can't override the key we just wrote.
    const last = obj.properties[obj.properties.length - 1];
    const indent = last ? indentOf(last) : ' '.repeat(sf.getLineAndCharacterOfPosition(obj.getStart(sf)).character + 2);
    const entry = `speculationRules: ${serialize(indent)}`;
    if (last) {
      magic.appendLeft(last.getEnd(), `,\n${indent}${entry}`);
    } else {
      magic.appendLeft(obj.getStart(sf) + 1, `\n${indent}${entry},`);
    }
    action = 'inserted';
  }

  await Bun.write(entryPath, magic.toString());
  return { action, multipleServeCalls: serveCalls.length > 1 };
}
