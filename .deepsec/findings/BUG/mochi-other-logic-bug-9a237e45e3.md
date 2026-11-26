# [BUG] `buildPropsFromAst` interpolates attribute names as bare object keys, so a hyphenated prop on any island emits invalid JavaScript

**File:** [`packages/mochi/src/compiler/svelteAstPreprocess.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/svelteAstPreprocess.ts#L544-L571) (lines 544, 547, 556, 571)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Every branch of `buildPropsFromAst` splices `attr.name` into an object literal without quoting it:

  L544: entries.push(`${attr.name}: true`);
  L547: entries.push(`${attr.name}: ${source.slice(expr.start, expr.end)}`);
  L556: entries.push(`${attr.name}: ${JSON.stringify(text)}`);
  L571: entries.push(`${attr.name}: \`${tpl}\``);

Svelte permits any HTML attribute name on a component and forwards it verbatim as a prop name, so `data-testid`, `aria-label`, and `data-*` are all legal authoring. For those, the generated expression is `{data-testid: "row-1"}`, which is not a valid JS object literal. The generated text lands inside a Svelte expression tag (`props-ref={__mochi_emit_props__({data-testid: "row-1"})}` at L382, or the signed-props envelope at L300/L318), so the Svelte compiler reports a parse error pointing at framework-generated source the author never wrote.

Note the inner component invocation is unaffected — `propsSource` (L363-366) re-emits the raw attribute source, so the prop reaches the component correctly during SSR. Only the serialized props payload breaks, which is why this is invisible until someone puts a dashed attribute on an island. `compiler/svelteAstPreprocess.test.ts` covers string literals, entities, nested braces, `<` in expressions, and arrow functions, but no non-identifier attribute name.

## Recommendation

Quote non-identifier keys when building the literal: `const key = /^[A-Za-z_$][\w$]*$/.test(attr.name) ? attr.name : JSON.stringify(attr.name);` and use `key` in all four `entries.push` call sites. Add tests for `data-*`/`aria-*` attributes on `mochi:hydrate`, `mochi:clientOnly`, and `mochi:defer` islands.

## Revalidation

**Verdict:** true-positive

Verified line by line. All four `entries.push` sites in `buildPropsFromAst` (L544, L547, L556, L571) splice `attr.name` in as a bare object key, and the only name filter is `attr.name.startsWith('mochi:')` (L540). For `data-testid="row-1"` the value is a single Text part, so the pure-text branch emits `data-testid: "row-1"`, producing the object literal `{data-testid: "row-1"}` — which JS parses as `data - testid`, a syntax error. That text is spliced into a Svelte expression tag (`props-ref={__mochi_emit_props__(...)}` at L382/L240, or the signed-props envelope at L300/L318), so the Svelte compiler reports a parse error in framework-generated source the author never wrote. Two independent confirmations that the preconditions hold: (a) Svelte's AST keeps arbitrary attribute names as plain `Attribute` nodes — `findMochiDirectives` relies on exactly that to see `mochi:hydrate`, whose name is not an identifier either; (b) dashed attributes on components are legal and already idiomatic in this repo — `aria-hidden="true"` is passed to `@lucide/svelte` components in packages/docs/_components/Callout.svelte:16, ComparisonTable.svelte, PersistenceTable.svelte, packages/site/src/ci/*.svelte. Those call sites are not islands, which is exactly why the bug is latent: `buildPropsFromAst` never runs on them. I confirmed the inner component invocation is unaffected (`propsSource` at L363-366 re-emits raw attribute source), so only the serialized props payload breaks. svelteAstPreprocess.test.ts covers literals, entities, nested braces, `<` in expressions and arrow functions, but no non-identifier attribute name. Given how common `aria-*`/`data-*` forwarding is, a user is fairly likely to hit this. Correctness/DX bug, no security impact: BUG.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-13)
