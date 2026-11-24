# [BUG] Unbounded `warned` Set grows once per distinct island name (memory leak)

**File:** [`packages/mochi/src/islands/inlineServerIslands.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/islands/inlineServerIslands.ts#L7-L31) (lines 7, 26, 31)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-memory-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`warned` is a module-level `Set<string>` that is never pruned or capped, and its keys embed caller-supplied values: `invalid:${String(opts.name)}` (L26) and `inline:${opts.name}` (L31). `shouldInlineIsland` runs on every non-visible `mochi:defer` call site on every island-endpoint render, so any app that derives the island name from request data accumulates one permanent entry per distinct value. Example: `<Row mochi:defer={{ name: `row-${item.id}`, inline: true }} />` in a list — every distinct `item.id` ever rendered adds an entry that lives for the process lifetime. The `invalid:` key has the same shape for non-string names (a per-row numeric id yields `invalid:1`, `invalid:2`, …; object names collapse to `[object Object]` and are harmless). The dedup intent documented at L9 ('once per offending value, not per render') is correct, but the key space is unbounded, so the cache is effectively a leak on a long-running server and can be amplified by an attacker who drives the id space (paginating or searching a large table).

## Recommendation

Cap the set (e.g. stop inserting past a few hundred entries, or switch to a bounded LRU), or key the warning on the call site rather than the dynamic value — for the `inline:` case the message does not depend on the name, so a single boolean flag per offending component would do.

## Revalidation

**Verdict:** true-positive

Confirmed: `warned` is a module-level `Set<string>` with no cap and no pruning (inlineServerIslands.ts:7-15), and both key shapes embed caller data — `invalid:${String(opts.name)}` (L26) and `inline:${opts.name}` (L31). The function is hot by construction: the preprocessor emits `{#if __mochi_inline_island__(…)}` at every non-visible `mochi:defer` call site (svelteAstPreprocess.ts:344, imported as `shouldInlineIsland` via the `mochi-server-island-runtime` virtual module), so it executes on every render of such a site, in page renders as well as island-endpoint renders. Both warning branches sit ahead of the budget check and so fire in either context. Growth needs an app to pass a dynamic `name`, which the reload API explicitly invites, plus one of the two warned-about mistakes: a non-string name (`name: item.id` yields `invalid:1`, `invalid:2`, … — note `isReloadableIslandName` requires a non-empty string, deferInvalidation.ts:16-18) or `inline: true` on a named island, which is ignored but otherwise harmless so a developer may well ship it. In either case each distinct id permanently adds a string to a process-lifetime Set — and emits a `logger.warn` line per distinct value, so the log spam is arguably the louder symptom — and an attacker who drives the id space (paginating or searching a large table) amplifies it at will. The dedup intent at L9 is correct; only the key space is wrong, and the `inline:` message does not even depend on the name, so a per-component flag or a bounded LRU fixes it. Impact is bounded by the misuse precondition and by string size, so BUG with low practical severity is the right call.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
