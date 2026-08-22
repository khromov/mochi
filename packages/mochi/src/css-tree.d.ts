// Subpaths, not the root entry: that eagerly loads ~400 kB of mdn-data for a lexer we never use. @types/css-tree
// covers only the root and can't be a devDependency, since consumers typecheck our published .ts sources — so the
// slice we use is pinned here instead, as in `negotiator.d.ts`. A *script*, pulled in from `compiler/cssAst.ts`.
declare module 'css-tree/parser' {
  export interface CssLocation {
    start: { offset: number };
    end: { offset: number };
  }

  interface NodeBase {
    loc?: CssLocation | null;
  }

  export interface Atrule extends NodeBase {
    type: 'Atrule';
    name: string;
    block: Block | null;
  }
  export interface Block extends NodeBase {
    type: 'Block';
    children: Iterable<CssNode>;
  }
  export interface Declaration extends NodeBase {
    type: 'Declaration';
    property: string;
    value: Value | Raw;
  }
  export interface FunctionNode extends NodeBase {
    type: 'Function';
    name: string;
    children: Iterable<CssNode>;
  }
  export interface Identifier extends NodeBase {
    type: 'Identifier';
    name: string;
  }
  export interface Operator extends NodeBase {
    type: 'Operator';
    value: string;
  }
  export interface Raw extends NodeBase {
    type: 'Raw';
    value: string;
  }
  export interface StringNode extends NodeBase {
    type: 'String';
    value: string;
  }
  export interface UnicodeRange extends NodeBase {
    type: 'UnicodeRange';
    value: string;
  }
  export interface Url extends NodeBase {
    type: 'Url';
    value: string;
  }
  export interface Value extends NodeBase {
    type: 'Value';
    children: Iterable<CssNode>;
  }

  /** Only the node types this pipeline reads; css-tree emits many more. */
  export type CssNode = Atrule | Block | Declaration | FunctionNode | Identifier | Operator | Raw | StringNode | UnicodeRange | Url | Value;

  const parse: (source: string, options?: { positions?: boolean; parseCustomProperty?: boolean }) => CssNode;
  export default parse;
}

declare module 'css-tree/walker' {
  import type { CssNode } from 'css-tree/parser';

  const walk: <Type extends CssNode['type']>(ast: CssNode, options: { visit: Type; enter: (node: Extract<CssNode, { type: Type }>) => void }) => void;
  export default walk;
}
