import { parse } from 'svelte/compiler';

type Node = { type: string; [key: string]: unknown };

function collect(node: unknown, out: Set<string>, inImport: boolean): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out, inImport);
    }
    return;
  }
  const n = node as Node;
  if (typeof n.type !== 'string') {
    return;
  }
  // An import's own specifiers are not uses of themselves.
  if (n.type === 'ImportDeclaration') {
    return;
  }
  if (n.type === 'Identifier' && typeof n.name === 'string') {
    out.add(n.name);
  }
  // `<Foo.Bar />` in markup keeps the `Foo` import alive.
  if (n.type === 'Component' && typeof n.name === 'string') {
    out.add(n.name.split('.')[0]!);
  }
  for (const [key, value] of Object.entries(n)) {
    if (key !== 'type') {
      collect(value, out, inImport);
    }
  }
}

/**
 * Every name a parsed module or component still mentions, ignoring import declarations themselves.
 *
 * Used to decide whether an import survived inlining. It walks the AST rather than the text because an inlined value is
 * frequently source code itself — the demo source viewer bakes in highlighted Svelte, which contains the very
 * identifiers being tested for — and a textual scan would match inside those string literals and never prune anything.
 * Over-reporting is safe here: a name wrongly kept only leaves an unused import.
 */
export function referencedNames(source: string, kind: 'svelte' | 'module'): Set<string> {
  const out = new Set<string>();
  const ast = parse(source, { modern: true }) as unknown as {
    instance?: { content: unknown };
    module?: { content: unknown };
    fragment?: unknown;
  };
  if (kind === 'module') {
    collect(ast.module?.content, out, false);
    return out;
  }
  collect(ast.module?.content, out, false);
  collect(ast.instance?.content, out, false);
  collect(ast.fragment, out, false);
  return out;
}
