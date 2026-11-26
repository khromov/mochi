# [BUG] Lazy init memoizes only the resolved value, so concurrent requests each run a full varlock load() — and a failing load() re-runs forever

**File:** [`packages/site/src/demos/varlock/env.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/varlock/env.ts#L27-L47) (lines 27, 29, 30, 34, 47)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`cached` is assigned only after `await load()` resolves (line 47), while the guard reads it at line 30. Every request that arrives during the first load's window therefore sees `cached === null` and starts its own `load()`. There is no in-flight promise to await and no negative caching.

`load()` is not cheap or side-effect-free: `loadVarlockEnvGraph()` → `loadEnvGraph()` constructs a disk-backed `CacheStore()`, probes the local-encrypt backend, reads and parses `.env.schema`, builds and resolves the whole graph, then `process.env.__VARLOCK_ENV = JSON.stringify(...)` and `initVarlockEnv()`. That last call *deletes* varlock's previously injected keys from `process.env` and then rewrites the entire boot-time `envState.originalProcessEnv` snapshot back over `process.env` (env-CeXQINKg.mjs:549-554). So N concurrent unauthenticated GETs to `/demos/varlock/` produce N concurrent graph loads, each performing wholesale mutation of the shared process environment of the production web server, interleaved in attacker-controlled order.

The worse half is the error path. `load()` throws on any schema or validation failure (`checkForSchemaErrors` / `checkForConfigErrors`) — for example if the deployed environment sets `DEMO_SECRET_KEY` to something that does not start with `sk-`, since declared keys resolve from `process.env` via `overrideValues`. Because the failure is never recorded, `cached` stays `null` permanently and **every subsequent request re-runs the entire load from scratch and re-prints the multi-line error block (`getItemSummary` per failing item) to stderr**. That is an unbounded, unauthenticated CPU-and-log amplification loop on a public page that never self-limits.

## Recommendation

Memoize the promise, not the value: `let pending: Promise<VarlockConfig> | null = null; export function loadVarlockConfig() { return (pending ??= build()); }`. Decide the failure policy explicitly — either keep the rejected promise cached (so a bad config fails fast and quietly) or reset `pending` on rejection behind a retry backoff, but do not leave an unbounded retry-and-log loop reachable from an unauthenticated route.

## Revalidation

**Verdict:** true-positive

The code defect is exactly as described and I confirmed it line by line: `cached` is assigned only at env.ts:47, after `await load()` at L34, while the guard reads it at L30 — so there is no in-flight promise to join and no negative caching. Every request arriving inside the first load's window starts its own `load()`, and `load()` is genuinely heavy and side-effecting: `loadVarlockEnvGraph()` → `loadEnvGraph()` constructs a disk-backed `CacheStore`, probes the local-encrypt backend, parses and resolves the graph, then `load()` writes `process.env.__VARLOCK_ENV` and calls `initVarlockEnv()`, which deletes previously-injected keys and rewrites `envState.originalProcessEnv` back over `process.env` (env-CeXQINKg.mjs:547-556). The error half is the substantive part and it is correct: `checkForSchemaErrors`/`checkForConfigErrors` throw, `cached` stays null forever, and every subsequent request re-runs the whole load and re-prints the per-item error block to stderr — an unauthenticated, unbounded retry-and-log loop on a public page with no self-limiting, reachable if a deployed environment ever sets `DEMO_SECRET_KEY` to something not matching `startsWith=sk-` or `DEMO_APP_ENV` outside the enum (both resolve from `process.env` via `overrideValues`), or on any transient load failure. Two corrections that do not change the verdict: `initVarlockEnv()` is fully synchronous, so concurrent loads cannot interleave *inside* it and each rewrite is atomic and idempotent — 'interleaved in attacker-controlled order' overstates the hazard to repeated identical rewrites; and the duplicate-load window only exists before the first success, so the concurrency half is a brief thundering herd rather than a standing exposure. BUG is the right severity, and memoizing the promise with an explicit failure policy is the correct fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-07)
