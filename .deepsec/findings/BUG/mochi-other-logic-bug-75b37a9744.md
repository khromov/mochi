# [BUG] Leak-test route is dev-gated but its only caller runs the server in production mode, silently dropping the server-island probe

**File:** [`packages/site/src/leak-test/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/leak-test/routes.ts#L6-L7) (lines 6, 7)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`/__leak/server-island` exists solely for `bun run test:leak` (per the file's own comment and `packages/mochi/scripts/leak/README.md:57-60`), but it is unreachable under that harness.

The route is mounted conditionally at `packages/site/src/routes.ts:385` — `...(DEVELOPMENT ? leakTestRoutes : {})`, where `DEVELOPMENT = process.env.NODE_ENV === 'development'` (line 89). That is the only registration site (verified: `leakTestRoutes` appears nowhere else). Meanwhile the harness spawns the site with `env: { MOCHI_MEMORY_PROBE: '1', NODE_ENV: 'production', PORT: ... }` (`scripts/leak/runLeakTest.ts:83`), merged as `{ ...process.env, ...opts.env }` in `scripts/leak/serverProcess.ts:37`. So `DEVELOPMENT` is always `false` in the measured process and the route is never registered.

Consequence: `captureServerIslandHit()` fetches `/__leak/server-island`, gets a 404, and returns `null` on `!res.ok` (`scripts/leak/routes.ts:41-44`). `runLeakTest.ts:97` then builds the load mix as `STATIC_ROUTES` only, permanently omitting the `island:server` hit against `/_mochi/island/:name`. `STATIC_ROUTES` includes `/demos/server-island`, but that only renders the *page* containing the deferred wrapper — a non-browser load generator never performs the second fetch — so the island endpoint itself (props decryption, dynamic `import()`, per-island compile cache) receives zero sustained traffic.

The memory-leak regression harness therefore no longer exercises the most allocation-heavy code path it was built to watch, and a leak there would ship undetected. It degrades with a single `console.warn` at line 99 that fires on every run, so it reads as normal output rather than a failure. The entire `packages/site/src/leak-test/` directory is also dead code under its only consumer. Note the same file set already documents the correct pattern: the profiler routes at `routes.ts:140-141` are deliberately *not* mode-gated, with the comment "Gating on the mode would put these out of reach of their only caller, which profiles the production build."

## Recommendation

Gate the leak routes on a dedicated opt-in env flag rather than the mode — the harness already sets one. Either reuse it (`process.env.MOCHI_MEMORY_PROBE === '1'`) or add `LEAK_TEST_ROUTES_ENABLED`, mirroring the `HEAP_SNAPSHOTS_ENABLED` pattern at `routes.ts:90`, and set it in `runLeakTest.ts`'s spawn env. Separately, make `runLeakTest.ts` fail loudly (non-zero exit) instead of warning when `captureServerIslandHit()` returns `null`, so a missing core probe can never be mistaken for a clean run.

## Revalidation

**Verdict:** true-positive

Verified every link in the chain. `packages/site/src/routes.ts:89` defines `const DEVELOPMENT = process.env.NODE_ENV === 'development'`, and line 385 is the *only* registration site for `leakTestRoutes` (`grep -rn leakTestRoutes` returns exactly two hits: the import at line 57 and the spread at line 385). `runLeakTest.ts:83` spawns the site with `env: { MOCHI_MEMORY_PROBE: '1', NODE_ENV: 'production', PORT }`, and `serverProcess.ts:37` merges it as `{ ...process.env, ...opts.env }`, so the child's `NODE_ENV` is unconditionally `production` — `DEVELOPMENT` is `false` and `/__leak/server-island` is never registered. I confirmed `packages/site/src/index.ts` passes only that one `routes` map and has no catch-all `fetch`, so the path reaches `composedFetch` and 404s; `captureServerIslandHit()` returns `null` on `!res.ok` (`scripts/leak/routes.ts:41-44`), `runLeakTest.ts:97` therefore builds the ring from `STATIC_ROUTES` alone, and the only signal is a `console.warn` at line 99. The `island:server` hit against `/_mochi/island/:name` is genuinely lost: `LeakIslandPage.svelte` uses `mochi:defer`, whose second fetch is performed by the `ServerIsland` client custom element, so the non-browser `loadGen` never issues it — and `/demos/server-island` in `STATIC_ROUTES` only renders the wrapper. Git history makes it worse, not better: before #338 the harness passed `MODE: 'production'` and inherited `NODE_ENV`, which I verified is `undefined` under `bun run` (no `.env` sets it), so `DEVELOPMENT` was already false — the probe has never worked under this harness. I downgrade HIGH_BUG → BUG: this is a manually-invoked internal harness (`grep test:leak .github/` is empty, so it is not a CI gate), nothing user-facing regresses, and it does emit a warning. The defect and the dead `packages/site/src/leak-test/` directory are real, and the fix the finding proposes mirrors the existing `HEAP_SNAPSHOTS_ENABLED` / profiler-route precedent in the same file.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
