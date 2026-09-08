import { walk } from 'zimmerframe';

type Node = { type: string; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

export function patternNames(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (!isNode(node)) {
    return out;
  }
  switch (node.type) {
    case 'Identifier':
      out.add(node.name as string);
      break;
    case 'ObjectPattern':
      for (const prop of (node.properties as Node[]) ?? []) {
        patternNames(prop.type === 'Property' ? prop.value : prop.argument, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of (node.elements as Node[]) ?? []) {
        patternNames(el, out);
      }
      break;
    case 'AssignmentPattern':
      patternNames(node.left, out);
      break;
    case 'RestElement':
      patternNames(node.argument, out);
      break;
    default:
      break;
  }
  return out;
}

export function hoistedNames(body: unknown): Set<string> {
  const names = new Set<string>();
  for (const stmt of (body as Node[]) ?? []) {
    if (!isNode(stmt)) {
      continue;
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const d of (stmt.declarations as Node[]) ?? []) {
        patternNames(d.id, names);
      }
    } else if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && isNode(stmt.id)) {
      names.add(stmt.id.name as string);
    }
  }
  return names;
}

function isReference(node: Node, parent: Node | undefined): boolean {
  switch (parent?.type) {
    case 'MemberExpression':
      return parent.computed === true || parent.property !== node;
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      return parent.computed === true || parent.shorthand === true || parent.key !== node;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'MetaProperty':
      return false;
    default:
      return true;
  }
}

/** Scope is flattened because a missed reference only makes the twin fail with a clear error, whereas an invented one would reject valid user code. */
export function freeIdentifiers(expression: Node): Set<string> {
  const declared = new Set<string>();
  const referenced = new Set<string>();
  walk(expression, null, {
    _(node, { next, path }) {
      // acorn-typescript emits TS* nodes for annotations; nothing inside one is a value reference.
      if (node.type.startsWith('TS')) {
        return;
      }
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'ClassDeclaration':
        case 'ClassExpression':
          if (isNode(node.id)) {
            declared.add(node.id.name as string);
          }
          for (const param of (node.params as Node[]) ?? []) {
            patternNames(param, declared);
          }
          break;
        case 'VariableDeclarator':
          patternNames(node.id, declared);
          break;
        case 'CatchClause':
          patternNames(node.param, declared);
          break;
        case 'Identifier':
          if (isReference(node, path.at(-1))) {
            referenced.add(node.name as string);
          }
          break;
        default:
          break;
      }
      next();
    },
  });
  return referenced.difference(declared);
}
