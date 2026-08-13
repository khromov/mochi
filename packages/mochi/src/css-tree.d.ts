// css-tree's root entry eagerly loads `lib/data.js`, which pulls ~400 kB of mdn-data JSON to build a
// lexer we never use — a boot cost every Mochi app would pay. The `parser`/`walker` subpaths skip it,
// but @types/css-tree only declares the root module, so the two subpaths are declared here. This file
// is intentionally a *script* (no top-level import/export) so `declare module` registers as an ambient
// declaration; it is pulled in via the triple-slash reference in `compiler/cssAst.ts`.
declare module 'css-tree/parser' {
  const parse: (source: string, options?: import('css-tree').ParseOptions) => import('css-tree').CssNode;
  export default parse;
}

declare module 'css-tree/walker' {
  const walk: (ast: import('css-tree').CssNode, options: import('css-tree').WalkOptions | import('css-tree').EnterOrLeaveFn) => void;
  export default walk;
}
