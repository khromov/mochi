# [BUG] Duplicate query parameters crash the hydrated island on the page this route serves

**File:** [`packages/site/src/demos/url/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/url/routes.ts#L5) (lines 5)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

This route mounts `Url.svelte`, which renders `UrlInfo` twice — once as an SSR snapshot and once as a `mochi:hydrate` island (`Url.svelte:13-15`). `UrlInfo.svelte:9` flattens the query string with `[...url.searchParams]`, which preserves repeated parameter names, and `UrlInfo.svelte:31` iterates those entries with a keyed each keyed on the parameter *name*: `{#each getParams() as [key, value] (key)}`.

Any request with a repeated parameter — `/demos/url/?name=a&name=b`, or simply a link carrying a duplicated tracking param — yields duplicate keys. The two render paths then disagree:

- Svelte 5's server renderer performs no key validation (`each_key_duplicate` exists only under `node_modules/svelte/src/internal/client/`), so SSR emits both rows and the response is a clean 200.
- The client runtime detects `length > keys.size` and throws `each_key_duplicate` in **both** dev and production builds — the prod branch still throws, just without the diagnostic detail (`node_modules/svelte/src/internal/client/dom/blocks/each.js:356-363`, Svelte 5.57.3).

So the hydrated instance fails to hydrate. Because the preprocessor auto-wraps `mochi:hydrate*` islands in `<svelte:boundary>`, the blast radius is contained to that island degrading to its failure stub plus a console error rather than taking down the page — which is why this is a bug rather than a denial-of-service finding. It is still reachable by anyone via a crafted link, and notably on a page whose own description (`Url.svelte:9`) invites the reader to "Try adding ?name=mochi to the URL". The pattern is unique to this file — no other component in `packages/site` or `packages/demos` spreads `searchParams` into a keyed each.

## Recommendation

Make the each-key unique per entry instead of per parameter name, in `packages/site/src/demos/url/UrlInfo.svelte`. Either key on the index (`{#each getParams() as [key, value], i (i)}`), key on the pair (`(key + '=' + value + i)`), or drop the key entirely — the list is static within a render and gains nothing from keying. Since the demo's whole point is showing live query-string parsing, keying on the index while still rendering every repeated pair is the behaviour that best matches `URLSearchParams` semantics.

## Revalidation

**Verdict:** true-positive

I verified every link in the chain from source. `packages/site/src/demos/url/routes.ts:5` mounts `Url.svelte`, which is spread into the live site's route map (`packages/site/src/routes.ts:83` + `:410`), and `Url.svelte:13-15` renders `UrlInfo` twice — once plain (SSR-only) and once with `mochi:hydrate`. `UrlInfo.svelte:9` does `[...url.searchParams]`, and line 31 is `{#each getParams() as [key, value] (key)}` — keyed on the parameter *name*. On the server, `url` resolves through `__mochiCtxProxy('url')` (`compiler/virtual-modules/mochi-env.server.js:27`) to the request context's `URL` built by `buildPublicUrl` (`runtime/requestSetup.ts:89`), which preserves the query string verbatim; on the client it resolves to `new URL(window.location.href)` (`mochi-env.client.js:24-37`). So both renders see two entries for `?name=a&name=b`. I confirmed the Svelte 5.57.3 SSR transform (`compiler/phases/3-transform/server/visitors/EachBlock.js`) ignores `node.key` entirely — a plain `for` loop with no validation — and that `each_key_duplicate` exists only under `internal/client/`, so SSR emits both rows and returns 200. On the client, `internal/client/dom/blocks/each.js:356-363` runs `if (length > keys.size)` unconditionally (including on the first, hydrating run — I traced the function from line 267 and the check sits after the loop with no `hydrating`/`DEV` guard), and the non-DEV branch calls `e.each_key_duplicate('', '', '')`, which `internal/client/errors.js:145-147` throws in production too. I also confirmed the key function is generated as `([key, value]) => key` (`client/visitors/EachBlock.js:296-306`), so the two rows genuinely collide. The error propagates synchronously: `create_effect` re-throws (`reactivity/effects.js:137-142`), the root boundary created by `_mount` has only `{pending}` — no `failed`/`onerror` — so `Boundary.error()` re-throws (`boundary.js:473-476`), and it lands in `HydratableIsland._doHydrate`'s try/catch (`web-components/HydratableIsland.ts:56-65`), which logs and appends a `<mochi-island-failure>` stub (hidden in production by `ISLAND_FAILURE_CSS`). Attack/trigger is trivially concrete: any visitor following a link to `/demos/url/?name=a&name=b` (or any duplicated tracking param) on a page whose own copy invites `?name=mochi`. Two small corrections to the finding: the containment actually comes from the island hydrating inside its own custom element with a try/catch (the page itself is never hydrated, so the preprocessor's `<svelte:boundary>` is SSR-only here), and because `create_effect`/`destroy_effect` unwind the subtree the island's server HTML is likely torn down rather than left intact beside a stub — either way the failure is island-scoped, not a page crash. The finding is also anchored on `routes.ts` while the defect is in `UrlInfo.svelte:9,31`, which it states plainly and its recommendation targets correctly. File is unmodified since commit 11bbbe6b, so not fixed. BUG severity is right: no security impact, no DoS, but a real reachable correctness bug.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-26)
