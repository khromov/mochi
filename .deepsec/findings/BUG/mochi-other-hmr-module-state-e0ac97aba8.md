# [BUG] Unpinned module state splits the cron writer from the socket registry after a dev entry rebuild, silently breaking the demo

**File:** [`packages/site/src/demos/cron/cron.server.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/cron/cron.server.ts#L7-L21) (lines 7, 8, 11, 21)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-hmr-module-state`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`log`, `seq` and `clients` are plain module-scoped bindings (lines 7, 8, 11). packages/docs/170-development-mode.md:88 states the rule for exactly this case: "Moving the singleton into a module the entry imports does **not** help — that module is first-party, so it is exactly what gets re-evaluated. Hold the resource with `pinGlobal` instead." The framework even warns about it at runtime (`recompile:module-churn`: "module-scoped resources leak on each reload").

Traced failure path on any watched entry edit in dev:
1. devWatcher.ts:598 calls `buildEntry()`, which re-imports a freshly built entry bundle — a new `cron.server.ts` instance with an empty `log`, `seq = 0`, and an empty `clients` Set.
2. devWatcher.ts:517-518 swaps `wsHandlersMap.set(pattern, handler.handlers)` to the *new* instance's `addClient`/`removeClient`, while already-open sockets keep running.
3. devWatcher.ts:369-374 `reconcileCron` compares `cronSignature(cron)`; a route-only edit leaves name/schedule/tz/dev unchanged, so it returns early and `startCronRuntime` is not re-run. bun-boss therefore keeps the worker closure built at boot (`cronWorkHandler(job)`, queue.ts:898-904), which is bound to the **old** module instance's `job.run`.

Result: the still-scheduled cron appends to the old `log` and broadcasts to the old `clients` Set (now empty), while every new socket is registered in the new instance's Set. The demo page connects, reports status "connected", receives an empty snapshot, and never receives another row until the dev server is fully restarted — and because the live bun-boss closure pins the old module instance, its `log`, `seq` and `clients` are retained on every reload. Production is unaffected (no HMR), and dev live-reload masks it as "the page just stopped updating", which is why it reads as a demo that is broken rather than a reload artifact.

## Recommendation

Hold the demo's state with the framework's documented process singleton, e.g. `const state = pinGlobal('mochi-demo:cron-log', () => ({ log: [] as CronLogEntry[], clients: new Set<WsClient>(), seq: 0 }))` (imported from `mochi-framework`, as packages/site/src/lib/highlight.server.ts already does), and read `log`/`seq`/`clients` off it. Alternatively, broadcast through Bun's pub/sub (`ws.subscribe(TOPIC)` / `ws.publish(TOPIC, …)`) like the chat demo, so the subscriber registry lives in Bun rather than in a module binding that HMR duplicates.

## Revalidation

**Verdict:** true-positive

I verified the whole chain end to end. `log` (cron.server.ts:7), `seq` (:8) and `clients` (:11) are plain module bindings. On a watched entry-graph edit, devWatcher's `buildEntry()` calls `extractServeOptions(outFile, { fresh: true })`, producing a brand-new `cron.server.ts` instance with an empty `log`, `seq = 0` and an empty `clients`. `applyRouteChanges` then hits the in-place ws branch and does `wsHandlersMap.set(pattern, handler.handlers)`, so all *new* sockets register into the new instance's Set. The decisive link is `reconcileCron`: `cronSignature` (cron.ts:78-80) hashes only `[name, schedule, tz, dev]` — not the handler — so a route-only edit leaves the signature identical and `reconcileCron` returns early without calling `startCronRuntime`. bun-boss therefore keeps the worker registered at boot, and `cronWorkHandler(job)` (queue.ts:898-904, wired at :983) closed over the *old* `job`, whose `run` references the old module's `log`/`seq`/`clients`. So the cron keeps appending to the orphaned `log` and broadcasting to the orphaned Set while every new socket is registered elsewhere: the page connects, reports connected, gets an empty snapshot from the new (empty) `log`, and never receives another row. The leak is real too — because `close` is dispatched via a live `wsHandlersMap.get(...)` lookup (Mochi.ts:2006), a pre-reload socket's close goes to the *new* `removeClient` and never clears the old Set, and the live bun-boss closure pins the old module instance so nothing is collected. The framework documents exactly this trap (170-development-mode.md:88, prescribing `pinGlobal`) and warns on it at runtime (`recompile:module-churn`, events.ts:473 / consoleLogger.ts:418), and the site already uses `pinGlobal` elsewhere (lib/docs.ts:55, lib/blog.ts:30, lib/highlight.server.ts:68). Dev-only, no production or security impact — BUG severity is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
