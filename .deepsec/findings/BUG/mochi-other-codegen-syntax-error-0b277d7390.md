# [BUG] `IDENT_RE` admits reserved words, so a reserved-word export name generates `export const class = …` and fails the whole client build

**File:** [`packages/mochi/src/compiler/serverOnlyScan.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/serverOnlyScan.ts#L7-L54) (lines 7, 19, 47, 54)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-codegen-syntax-error`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`IDENT_RE` is `/^[A-Za-z_$][\w$]*$/` (L7), which matches JavaScript reserved words. An ESM `ExportSpecifier` accepts any `IdentifierName`, including reserved words, so `export { del as delete }`, `export { Row as class }` or `export { make as new }` in a `.server.ts` (or in a `.server.svelte` `<script module>`) are valid source and `Bun.Transpiler.scan()` reports `delete`/`class`/`new` as named exports.

`scanServerOnlyExports` therefore pushes them into `named` (L19-20), and `buildServerOnlyStubModule` emits `export const ${name} = …` (L54) plus `function ${safeName}() {}` (L47, where `safeName === name` because `IDENT_RE.test(name)` passed). Both positions require a *binding identifier*, where reserved words are illegal — so the generated stub module is a hard `SyntaxError`, and because Bun `onLoad` contents are parsed as part of the graph, the entire island client build fails with an error pointing at a synthetic module the developer never wrote.

The codebase already knows the safe pattern: `prerenderModules.ts:182` emits `export { ${local} as ${name} }`, the indirect form where a reserved word is legal. The existing tests cover string-named exports (`serverOnlyScan.test.ts:158-165`) but not reserved-word identifier names, so this gap is untested.

## Recommendation

Use the indirect export form so any `IdentifierName` is safe, mirroring `prerenderModules.ts:182`: declare `const __mochi_stub_${i}__ = <stub>;` and emit `export { __mochi_stub_${i}__ as ${name} }` (or `as ${JSON.stringify(name)}` for non-identifier names, which would also let the string-named exports currently dropped with a warning be stubbed properly). Keep `safeName` falling back to `_serverOnly` whenever `name` is a reserved word. Add a test for `export { x as class }`.

## Revalidation

**Verdict:** true-positive

Mechanically correct. `IDENT_RE = /^[A-Za-z_$][\w$]*$/` (serverOnlyScan.ts:7) matches reserved words, and an ESM `ExportSpecifier` accepts any `IdentifierName`, so `export { del as delete }` / `export { Row as class }` is valid source and importable as `import { class as X }`. The scan at L16-23 therefore routes such a name into `named` rather than the warning branch, `buildServerOnlyStubModule` emits `export const ${name} = ...` (L54), and `safeName` (L47) resolves to the reserved word itself because `IDENT_RE.test` passed, yielding `function class() {}` (L49). Both positions require a binding identifier, where reserved words are illegal, so the synthetic stub module is a hard SyntaxError — and because onLoad contents are parsed as part of the graph, the whole island client build fails pointing at a module the developer never wrote. I corroborated that `Bun.Transpiler.scan()` reports alias names verbatim (not normalized or dropped) via serverOnlyScan.test.ts:158-165, where `export { x as "weird-name" }` surfaces as the name `weird-name`; a reserved-word alias is reported the same way but, unlike the string form, passes `IDENT_RE` and so is not caught. The repo already knows the safe pattern — prerenderModules.ts:182 uses the indirect `export { local as name }` form, where any `IdentifierName` is legal. Likelihood is low: aliasing an export to a reserved word is awkward to consume and nobody in this repo does it, and strict-mode-reserved words like `package`/`private` can only arrive via such an alias. So it is a genuine but unlikely codegen robustness gap, correctly scoped as BUG, and the recommended indirect-export fix would additionally let the currently-dropped string-named exports be stubbed properly.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-08)
