type Node = { type: string; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

/** Every name a binding pattern introduces (`{a, b: [c]}`, `...rest`, `x = 1`). */
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

/** Names a statement list declares, gathered up front so a reference earlier in the block still resolves to the local. */
function hoistedNames(body: unknown): Set<string> {
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

function withNames(bound: ReadonlySet<string>, extra: Iterable<string>): Set<string> {
  const next = new Set(bound);
  for (const name of extra) {
    next.add(name);
  }
  return next;
}

function functionScope(node: Node, bound: ReadonlySet<string>): Set<string> {
  const names = new Set<string>();
  if (isNode(node.id)) {
    names.add(node.id.name as string);
  }
  for (const param of (node.params as Node[]) ?? []) {
    for (const name of patternNames(param)) {
      names.add(name);
    }
  }
  return withNames(bound, names);
}

/**
 * Identifiers an expression references but does not itself bind.
 *
 * Conservative in one direction only: missing a reference makes the generated twin fail to compile with a clear error,
 * whereas inventing one would reject valid user code. So non-reference positions — member properties, non-computed
 * object keys, labels, and TypeScript type nodes — are skipped explicitly rather than filtered out afterwards.
 */
export function freeIdentifiers(expression: unknown): Set<string> {
  const free = new Set<string>();

  const visit = (node: unknown, bound: ReadonlySet<string>): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child, bound);
      }
      return;
    }
    if (!isNode(node)) {
      return;
    }

    // acorn-typescript emits TS* nodes for annotations; nothing inside one is a value reference.
    if (node.type.startsWith('TS')) {
      return;
    }

    switch (node.type) {
      case 'Identifier': {
        const name = node.name as string;
        if (!bound.has(name)) {
          free.add(name);
        }
        return;
      }
      case 'MemberExpression':
        visit(node.object, bound);
        if (node.computed) {
          visit(node.property, bound);
        }
        return;
      case 'Property':
        if (node.computed) {
          visit(node.key, bound);
        }
        visit(node.value, bound);
        return;
      case 'PropertyDefinition':
        if (node.computed) {
          visit(node.key, bound);
        }
        visit(node.value, bound);
        return;
      case 'MethodDefinition':
        if (node.computed) {
          visit(node.key, bound);
        }
        visit(node.value, bound);
        return;
      case 'LabeledStatement':
        visit(node.body, bound);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const scope = functionScope(node, bound);
        visit(node.body, scope);
        for (const param of (node.params as Node[]) ?? []) {
          // Defaults can reference outer names: `(a = outer) => …`.
          visitPatternDefaults(param, scope, visit);
        }
        return;
      }
      case 'CatchClause': {
        const scope = withNames(bound, patternNames(node.param));
        visit(node.body, scope);
        return;
      }
      case 'BlockStatement':
      case 'Program': {
        const scope = withNames(bound, hoistedNames(node.body));
        visit(node.body, scope);
        return;
      }
      case 'VariableDeclarator':
        // The declared names are already in scope via the enclosing block's hoist pass.
        visit(node.init, bound);
        return;
      default:
        break;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key !== 'type' && key !== 'start' && key !== 'end' && key !== 'loc' && key !== 'range') {
        visit(value, bound);
      }
    }
  };

  visit(expression, new Set());
  return free;
}

function visitPatternDefaults(node: unknown, bound: ReadonlySet<string>, visit: (n: unknown, b: ReadonlySet<string>) => void): void {
  if (!isNode(node)) {
    return;
  }
  if (node.type === 'AssignmentPattern') {
    visit(node.right, bound);
    visitPatternDefaults(node.left, bound, visit);
    return;
  }
  if (node.type === 'ObjectPattern') {
    for (const prop of (node.properties as Node[]) ?? []) {
      visitPatternDefaults(prop.type === 'Property' ? prop.value : prop.argument, bound, visit);
    }
    return;
  }
  if (node.type === 'ArrayPattern') {
    for (const el of (node.elements as Node[]) ?? []) {
      visitPatternDefaults(el, bound, visit);
    }
    return;
  }
  if (node.type === 'RestElement') {
    visitPatternDefaults(node.argument, bound, visit);
  }
}
