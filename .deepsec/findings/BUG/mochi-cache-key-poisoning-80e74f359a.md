# [BUG] Route param `:id` collides with a sibling literal cache key, letting an unauthenticated GET poison the shared Pokémon-list cache for all visitors

**File:** [`packages/site/src/demos/data-loading/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/data-loading/routes.ts#L6) (lines 6)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `cache-key-poisoning`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `:id` segment registered here reaches `DataLoading.svelte` unvalidated as `params.id` and is interpolated into a cache key: `pokemonCache.fetch(`pokemon:${id}`, detailFn)`. The same component, in the same `Promise.all`, also reads `pokemonCache.fetch('pokemon:list:151', listFn)` — the selector's option list, shared by every visitor to every `/demos/data-loading/*` page.

`:` is a legal path character and the framework documents that Bun route params are URL-decoded (`Mochi.ts:1465`: "Route params are URL-decoded and may contain `../`"), so `GET /demos/data-loading/list:151/` (or `list%3A151`) yields `id === 'list:151'` and therefore the key `pokemon:list:151` — byte-identical to the list key. The namespace has no delimiter that `id` cannot contain.

`MochiCache.run()` (cache/cache.ts:348-351) coalesces strictly by key and ignores the `fn` argument: `const existing = this.inflight.get(key); if (existing) return existing;`. So the two calls bind *different loaders* to *one* key, and the loser's `fn` is never invoked. The detail call is evaluated first in the `Promise.all` array and stays one microtask ahead through every await hop (`fetch` -> `fetchWithStatus` -> `lookup` -> `read` -> the synchronous `MemoryStorage.getItem`), so the detail loader deterministically registers the in-flight run and the list loader coalesces onto it.

Resulting write: `detailFn` requests `https://pokeapi.co/api/v2/pokemon/list%3A151`, gets a 404, returns `null`, and `run`'s write guard (generation unchanged, inflight still owned) stores `{value: null}` under `pokemon:list:151`.

The stale path makes this deterministic rather than a race. With `minTimeToStale: 14_400_000` (4h) and `maxTimeToLive: 86_400_000` (24h), the entry is stale for 20 of every 24 hours; in that window `lookup` (cache.ts:153-166) serves the old value and fires `void this.run(key, fn, generation)` as a background revalidation — with `fn` = the *detail* loader, since that call reaches the branch first. One request, no timing luck, list entry overwritten with `null`.

Impact on other users: `options` is `null` for the next 4 hours (served `fresh`, so nothing revalidates it). `PokemonSelector.svelte:16` does `{#each options as option (option.name)}`, which throws on a non-iterable. It is a `mochi:hydrate` island, so the preprocessor's outer `<svelte:boundary>` (svelteAstPreprocess.ts:404, "keeps an SSR throw inside the island from taking down the parent page render") swallows it and emits the failed-snippet placeholder: the Pokémon selector silently disappears from the page for every visitor, and the island also throws on client hydration. The attacker can renew the poison with one request every 4 hours. Secondary: while the list entry is still fresh, the attacker's own request gets the list array back as `pokemon`, so `pokemon?.types.map(...)` (DataLoading.svelte:25) throws at page top level — pages are not auto-wrapped in a boundary, so that falls through to the route error handler as a 500.

## Recommendation

Make the two key namespaces non-overlapping and validate the param. Either delimit the key so the user-controlled part cannot reach a sibling key (`pokemon:detail:${id}` + `pokemon:list:151`, keeping the literal keys in a disjoint prefix), or — better — encode the dynamic part: `pokemon:detail:${encodeURIComponent(id)}`. Additionally validate `:id` against the fetched option list (or `/^[a-z0-9-]{1,32}$/`) and return a 404 for anything else before touching the cache. Separately, consider making `MochiCache.run()` assert that a coalescing caller passed the same loader (or key the in-flight map by key + loader identity) so this class of mistake fails loudly instead of silently binding the wrong `fn` to a shared key.

## Revalidation

**Verdict:** true-positive

The collision and the poisoning write are real and I confirmed every link. `params.id` is the raw Bun route param (`extractParams` reads `req.params`; Mochi.ts:1465 documents that params are URL-decoded), surfaced to the component through the `__mochiCtxProxy('params')` in mochi-env.server.js; `(params.id ?? 'pikachu').toLowerCase()` leaves `list:151` untouched, so `pokemon:${id}` is byte-identical to the sibling literal `pokemon:list:151`. Pages are slash-mirrored (KIND_POLICY `trailingSlash: true`), so `/demos/data-loading/list:151/` matches without a redirect. `MochiCache.run()` (cache.ts:348-352) coalesces strictly on `inflight.get(key)` and discards the caller's `fn`, and the ordering is deterministic rather than racy: `Promise.all`'s array literal invokes the detail `fetch` first, both calls traverse an identical await chain (`fetchWithStatus` → `lookup` → `read` → the synchronous `MemoryStorage.getItem`), and `run` is a *synchronous* function that publishes `inflight.set(key, promise)` before returning — so the detail loader always owns the run and the list loader always coalesces onto it. In the 20-of-24-hour stale window `lookup` (cache.ts:153-166) fires `void this.run(key, detailFn, generation)` as the background revalidation, the write guard at cache.ts:368 passes (generation unchanged), and `{value: null}` lands on the shared list key. So an unauthenticated GET does overwrite shared cross-user cache state, renewably. I am downgrading severity because the stated impact is wrong: Svelte 5.57's `ensure_array_like` (server/index.js:435-442) and the client `each` (dom/blocks/each.js:211) both coerce `null`/falsy collections to `[]`, so `{#each options as option (option.name)}` renders zero options rather than throwing — there is no boundary placeholder, no failed-snippet, and no hydration throw. The realised effect is an empty `<select>` on one demo page for up to 4 hours, plus a self-inflicted 500 for the attacker in the fresh window (`pokemon` is the list array, so `pokemon?.types.map` throws at page top level, and pages are not auto-wrapped). The payload is also pinned to `null`: making the write non-null would require an `id` that is simultaneously `list:151` and a valid pokeapi id. Genuine defect and a genuine cache-poisoning primitive, but with a cosmetic ceiling.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
