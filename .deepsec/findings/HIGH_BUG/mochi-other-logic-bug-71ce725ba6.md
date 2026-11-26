# [HIGH_BUG] Server-island fixture targets a development-only route while the harness runs the server in production mode, so the island endpoint is never exercised

**File:** [`packages/mochi/scripts/leak/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/routes.ts#L41) (lines 41)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`captureServerIslandHit` (L37-57) fetches `${baseUrl}/__leak/server-island` to scrape a valid signed-props blob. That route is registered in `packages/site/src/routes.ts:385` as `...(DEVELOPMENT ? leakTestRoutes : {})`, where `DEVELOPMENT = process.env.NODE_ENV === 'development'` (routes.ts:89). But `runLeakTest.ts:83` spawns the server with `env: { MOCHI_MEMORY_PROBE: '1', NODE_ENV: 'production', PORT: … }`. So `DEVELOPMENT` is false, the leak-test route is never registered, the fetch 404s, `!res.ok` returns null (L42-44), and the island route is dropped from the mix.

`runLeakTest.ts:97-100` treats this as non-fatal: it logs `console.warn('[leak] Could not capture server-island blob — skipping that route')` and proceeds to produce an authoritative verdict. On a default 12-minute run that warning scrolls away minutes before the report prints, and `island:server` is simply absent from the per-route table rather than showing zero — so there is no visible signal in the output that coverage was lost.

This has been broken since the initial commit, not introduced by a recent change: before commit 4fbb17c6 the harness passed `MODE: 'production'` while the site computed `DEVELOPMENT = process.env.MODE === 'development'` — false in exactly the same way. The server-island endpoint (`/_mochi/island/:name`) is the single most leak-prone path in the framework: it runs `decryptProps`, compiles each island to `<outDir>/svelte-compile/<Name>-<hash>.server.js` on demand, and dynamically `import()`s it into a module cache that is never evicted. That is the class of leak this harness exists to catch, and it has never been exercised.

## Recommendation

Point the capture at a production-registered page instead — `/demos/server-island/` (with trailing slash) is the original design the README step 2 still describes, and it renders the same `<mochi-server-island>` element. If the artificial 1-3s `delay()` there is unacceptable, un-gate `leakTestRoutes` behind a dedicated `MOCHI_LEAK_ROUTES=1` env var that `runLeakTest.ts` sets, rather than tying it to `NODE_ENV`. Then make the missing capture fatal: `throw` instead of `console.warn`, so a dropped route can never be reported as a pass. Note also that `SERVER_ISLAND_RE` (L35) requires `component-name` to precede `signed-props`; that happens to match the current emission order in `compiler/svelteAstPreprocess.ts:300`, but any attribute reorder would silently re-break the capture the same way — worth a unit test over a recorded snippet.

## Revalidation

**Verdict:** true-positive

Confirmed. `captureServerIslandHit` (routes.ts:41) fetches `/__leak/server-island`. That pattern is registered only via `...(DEVELOPMENT ? leakTestRoutes : {})` at `packages/site/src/routes.ts:385`, with `DEVELOPMENT = process.env.NODE_ENV === 'development'` (routes.ts:89). `runLeakTest.ts:83` passes `env: { MOCHI_MEMORY_PROBE: '1', NODE_ENV: 'production', PORT: … }`, and `serverProcess.ts:37` spreads it as `{ ...process.env, ...opts.env }` so the override wins. So the route is absent, the fetch 404s, `!res.ok` returns null (routes.ts:42-44), and L97 drops `island:server` from the mix entirely. The failure is non-fatal: L98-100 only `console.warn` and the run continues to an authoritative verdict. I confirmed the warning is genuinely invisible in practice — the server is spawned with `stdout: 'inherit'` and the site runs `logger: { level: 'log' }` with consoleLogger active, so a default 660s run at 50 rps buries that single line under tens of thousands of request lines, and because the route is never added to the ring it does not even appear with a zero count in `printReport`'s per-route table. The readiness check is unaffected because `/__mochi/health/memory` is gated on `MOCHI_MEMORY_PROBE === '1'` alone (Mochi.ts:1816), not on `development`, so the harness boots cleanly and gives no other hint. The impact assessment is right: `/_mochi/island/:componentName` (Mochi.ts:1559+) runs `decryptProps`, compiles islands on demand to `<outDir>/svelte-compile/<Name>-<hash>.server.js`, and dynamically imports them into a never-evicted module cache — the single most leak-prone path, and the one this harness exists to cover. I also verified the finding's side-note: `svelteAstPreprocess.ts:300` and :318 both emit `component-name="…" signed-props={…}` in that order, so `SERVER_ISLAND_RE` matches today but is order-fragile. Note the inline-budget path (:306-323) only triggers inside a nested island-endpoint render, so a top-level page render still emits the matchable placeholder. Gitignored reports in `scripts/leak/reports/` dated 2026-05-02 show `island:server` at 3447 2xx, but those predate this repo's initial commit (2026-05-18) and reflect a harness/site state not in git — they are not evidence about current code. HIGH_BUG stands.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
