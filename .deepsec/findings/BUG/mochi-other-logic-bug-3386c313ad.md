# [BUG] A throwing IntersectionObserver construction escapes connectedCallback, killing the island with no failure stub

**File:** [`packages/mochi/src/web-components/sharedVisibilityObserver.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/sharedVisibilityObserver.ts#L21-L40) (lines 21, 25, 40)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`new IntersectionObserver(cb, { rootMargin })` throws a SyntaxError when rootMargin is not a valid CSS margin string, and `observeVisible` neither validates the value nor catches the throw, so it propagates out of `HydratableIsland.connectedCallback` (HydratableIsland.ts:43) — which is outside the `_doHydrate` try/catch at HydratableIsland.ts:57-65. The island therefore never hydrates, no `mochi-island-failure` stub is appended, and the only signal is an unhandled custom-element reaction error in the console, which is easy to miss in dev and invisible in production.

The value is author-supplied and evaluated at render time, not a compile-time literal: svelteAstPreprocess.ts:253/388 emit `hydrate-options={JSON.stringify(${visibleOptionsExpr})}`, so `mochi:hydrate:visible={{ rootMargin: someRuntimeValue }}` serializes whatever that expression produced. Concrete trigger: `mochi:hydrate:visible={{ rootMargin: 200 }}` (a number, an easy mistake given `rootMargin: '200px'` is the documented form) serializes to `{"rootMargin":200}`, survives `options.rootMargin || '0px'`, is IDL-converted to the unitless string "200", and throws. A unit-less or misspelled string value does the same. The number case additionally keys the pool Map at line 22 with a non-string, violating the declared `Map<string, Entry>`.

The same unguarded shape exists one line earlier at HydratableIsland.ts:40 (`JSON.parse(optionsRaw)`) and at ServerIsland.ts:30, where a parse throw leaves `_loaded = true` already set, so the island never fetches at all.

## Recommendation

Coerce and validate inside observeVisible: `const margin = typeof rootMargin === 'string' && rootMargin ? rootMargin : '0px'`, wrap the constructor in a try/catch that logs the offending value and falls back to '0px' (or fires onVisible immediately, so the island still hydrates). Separately, wrap the `hydrate-options` / `server-options` JSON.parse plus the observe call in HydratableIsland.connectedCallback in a try/catch that emits the failure stub, so an authoring mistake surfaces the same way a hydration throw does.

## Revalidation

**Verdict:** true-positive

The control-flow claim is exactly right and I found no mitigation anywhere. `observeVisible` passes `rootMargin` straight into `new IntersectionObserver(cb, { rootMargin })` (L25-41) with no coercion or try/catch, and its caller does only `options.rootMargin || '0px'` (HydratableIsland.ts:43) inside `connectedCallback`, which is outside the `_doHydrate` try/catch at HydratableIsland.ts:56-65. Per the IntersectionObserver spec the constructor throws a SyntaxError when rootMargin cannot be parsed as 1-4 length-percentage values, so the throw escapes the custom-element reaction: the island never hydrates, no `<mochi-island-failure>` stub is appended, `_hydrated` stays false with nothing to retry it, and there is no framework-level `window.onerror`/`unhandledrejection` listener anywhere in packages/mochi — so the only signal is a console entry. The value really is author-supplied and render-time, not a compile-time literal: svelteAstPreprocess.ts:253 and :388 emit `hydrate-options={JSON.stringify(<author expression>)}` verbatim, and the docs state the option is 'forwarded to IntersectionObserver' (60-lazy-hydration.md:21). Two caveats that I weighed but that do not overturn the finding. First, the headline trigger `rootMargin: 200` *is* caught by svelte-check, since `MochiHydrateVisibleOptions.rootMargin` is typed `string` and `mochi-svelte.d.ts` widens every component's props with `MochiDirectives`; the un-mitigated trigger is the invalid-*string* case the finding also names (`'200'`, `'20 px'`), which type-checks cleanly and throws identically. Second, the sub-claim that the number case keys the pool `Map` with a non-string is wrong in that specific case: the constructor at L25 throws before `pool.set` at L43 ever runs (an array value such as `['0px']` would do it, but that is contrived). The core defect stands and is a genuine robustness asymmetry — every other island failure path in this framework produces a logged error plus a stub, and the same unguarded shape repeats at ServerIsland.ts:30/44 where `_loaded = true` is already set at L27, leaving a deferred island on its fallback forever. Impact is limited to self-inflicted authoring mistakes (the value is not attacker-influenced), so BUG is the correct severity rather than anything higher.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
