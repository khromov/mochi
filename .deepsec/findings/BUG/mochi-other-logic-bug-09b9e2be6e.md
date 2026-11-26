# [BUG] `fail(400, { error })` from the form action is unreachable to the user — the page never reads a `form` prop

**File:** [`packages/site/src/demos/data-loading/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/data-loading/routes.ts#L12-L13) (lines 12, 13)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The action returns `fail(400, { error: 'Pokemon required' })` for an empty `pokemon` field. Per `runtime/forms.ts`, `fail` re-renders the page with the result injected as a `form` prop (`Mochi.ts:924-925`: `const resolvedProps = formProp === null ? baseProps : { ...baseProps, form: formProp }`). But `DataLoading.svelte` declares no props at all — it has no `$props()` destructuring and never references `form` — so the message is dropped on the floor: the visitor gets a 400 that re-renders the page unchanged, with no indication of what went wrong.

The branch is genuinely reachable, not dead code: with the list cache poisoned to `[]` (or any state where the `<select>` has no options), the `<noscript>` submit button or a hand-crafted POST sends an empty `pokemon`, hitting `fail`. A hand-crafted POST can reach it at any time.

## Recommendation

Either surface the error — add `let { form } = $props();` to `DataLoading.svelte` and render `{#if form?.error}<p class="error">{form.error}</p>{/if}` — or drop the `fail` branch and default the empty case to `pikachu`. Since this file is published verbatim as demo documentation via `files.ts`, the first option is the better teaching example of how `fail()` is meant to be consumed.

## Revalidation

**Verdict:** true-positive

Confirmed. On the non-enhanced path, `isFormFail(result)` sets `ctx.form = { ok: false, action, status, data }` and re-renders via `renderComponent(req, ctx, resolveOpts, result.status)` (Mochi.ts:1143-1153), and `renderComponent` injects it as `{ ...baseProps, form: formProp }` (Mochi.ts:924-925). `DataLoading.svelte` declares no `$props()` destructuring at all and never references `form` or `getRequestContext().form` — I read the whole file — so the payload is silently discarded and the visitor gets a 400 that re-renders the page unchanged with no error text. The non-enhanced path is the right one here: `PokemonSelector.svelte`'s form is a plain `<form method="POST">` with no `{@attach enhance(...)}`, unlike the login demo's. Reachability holds as well, and interestingly it is coupled to F3: once the list key is poisoned to `null` the `<select>` renders with zero `<option>` children (Svelte coerces the null collection to `[]`), the browser omits the `pokemon` field entirely on the `<noscript>` submit, `formData.get('pokemon')` is null, `String(null ?? '')` is `''`, and the `fail` branch fires. A hand-crafted same-origin POST reaches it unconditionally. Minor, but a genuine defect — and more so because `files.ts` publishes this file verbatim as reference material, so it teaches `fail()` without ever showing how the result is consumed. BUG severity is right.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
