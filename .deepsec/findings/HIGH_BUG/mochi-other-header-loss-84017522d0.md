# [HIGH_BUG] filterResponseHeaders silently collapses multiple Set-Cookie headers into one

**File:** [`packages/mochi/src/runtime/hooks.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/hooks.ts#L185-L190) (lines 185, 186, 187, 188, 189, 190)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-header-loss`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

applyResolveOptions rebuilds the header set with `filtered.set(name, value)` while iterating `result.headers.entries()`. Per the Fetch spec (verified on Bun 1.4.5), `set-cookie` is the one header that iterates as separate entries rather than being comma-combined, so `.set()` overwrites each previous one: a response carrying N Set-Cookie headers emerges with only the last. Any middleware that defines `filterResponseHeaders` — a documented, example-ed feature (docs/120-middleware.md:103-115) — silently destroys cookies on every response it touches, even a filter that returns `true` for everything.

Reachable paths where >=1 Set-Cookie is already on the response before the filter runs: (1) the `fetch` fallback at Mochi.ts:1905, `applyResolveOptions(finalizeCookieHeaders(await userFetch(...), cookies), resolveOpts)` — cookies are appended *before* the filter, so the jar's cookies plus any the user handler set get collapsed; (2) a form action returning its own Response (Mochi.ts:1130); (3) a `handleError` hook returning a Response (errors.ts:75). Page/API routes that set cookies through `ctx.cookies` are spared only by luck of ordering (finalizeCookieHeaders runs after the middleware chain at Mochi.ts:993).

The repo already has the correct primitive: `collectHeaderPairs()` in utils/index.ts:103-115 exists precisely because "getSetCookie() keeps multiple Set-Cookie headers as separate entries rather than comma-merging them". applyResolveOptions just doesn't use it, and no test in the monorepo exercises filterResponseHeaders at all.

## Recommendation

Rebuild the filtered headers with `append` over `collectHeaderPairs(result.headers)` (or iterate non-set-cookie entries plus `result.headers.getSetCookie()` explicitly), so repeated Set-Cookie values survive. Add a test asserting two cookies survive a pass-through filter.

## Revalidation

**Verdict:** true-positive

Confirmed, including the runtime semantics the bug depends on. applyResolveOptions rebuilds the header set with filtered.set(name, value) while iterating result.headers.entries() (hooks.ts:185-197). Bun's own release notes settle that iteration yields separate set-cookie entries rather than comma-merging them — v0.5.9 ships the exact test new Headers([['Set-Cookie','foo=bar']]) + append('set-Cookie','foo=baz') yielding two ['set-cookie', ...] pairs from [...headers] (and v0.8.0 'Fix iterating headers with set-cookie'). So .set() overwrites each prior cookie and only the last survives; note the bug holds even under the other possible semantics, since a comma-merged set-cookie value re-set as one header also loses every cookie after the first at the browser's parser. The framework definitely produces multiple headers: finalizeCookieHeaders uses headers.append('Set-Cookie', ...) per cookie (cookies.ts:143-145). Reachability is confirmed at every claimed site and one more: Mochi.ts:1905 finalizes the jar before the filter on the protected fetch-fallback path; Mochi.ts:1907-1908 passes the user's fetch Response straight in; Mochi.ts:1128-1130 does the same for a form action's own Response; errors.ts:74-75 for a handleError Response; and Mochi.ts:1226-1227 for every Mochi.api handler's Response — an API route that appends a session cookie and a CSRF cookie silently ships only the second. Page/API routes using ctx.cookies are spared only by ordering (finalize at Mochi.ts:993 / 1242, after the middleware chain), which is luck, not design. The repo already owns the correct primitive — collectHeaderPairs() (utils/index.ts:102-115) exists precisely because getSetCookie() keeps the values separate — and applyResolveOptions simply doesn't use it. I verified the coverage claim: grepping all *.test.ts in the monorepo returns zero hits for filterResponseHeaders, transformPage, or applyResolveOptions, and no in-repo app uses filterResponseHeaders (support/src/embedHeaders.ts only mentions it in a comment explaining why it rebuilds the Response instead). Silent loss of Set-Cookie on a documented, example-ed middleware feature justifies HIGH_BUG.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
