---
name: memory-regression
description: Analyze Mochi heap snapshots for memory regressions with memlab and suggest fixes. Use when the user says "analyze heap snapshots", "check for memory leaks", "memory regression", "run memlab", "analyze the snapshots", or "/memory-regression".
user-invocable: true
---

# Analyze heap snapshots for memory regressions

`memtest/analyze.ts` picks the **newest three** `.heapsnapshot` files in `./snapshots/`
and runs memlab's offline leak detector (baseline → target → final). Your job is to
run it, then map any leaked-object retainer traces back to Mochi source and propose fixes.

## Steps

1. **Check inputs.** `ls -lh snapshots/`. memlab needs **≥3** snapshots. If there are
   fewer, tell the user to capture more with the memtest harness (`memtest/README.md` has
   a no-Docker dry run) and stop — don't fabricate an analysis.

2. **Run the analyzer:** `bun run memtest:analyze`. It parses ~60 MB of heap JSON, so it
   takes a bit. It prints which three snapshots it chose (by mtime), memlab's own report,
   then a `=== SUMMARY ===` block: leak-trace count and the top leaked objects ranked by
   retained size. Exit code is non-zero when leaks are found.

3. **If no leaks:** report that cleanly. Optionally note the three snapshots analyzed and
   that a longer capture window (`SNAPSHOT_INTERVAL_MS`) may be needed to surface a slow leak.

4. **If leaks:** for each top cluster, read memlab's full retainer trace (leaked object →
   GC root, in the console report and the per-trace JSON under `.memtest-out/analyze/`).
   The trace names the property/edge chain holding the object. Follow it to the Mochi source
   that owns the retaining structure, then propose a concrete fix (evict/bound the cache,
   remove the listener on teardown, stop capturing request state in a module-level closure).

## Interpreting a trace

The retaining chain is read root-ward: `leaked object → …edge… → …edge… → GC root`. The
**last hop before a long-lived root** is usually the bug — a module-level `Map`/`Set`/array,
an event emitter's listener list, or a closure captured by a cached function. A leaked object
retained only by request-scoped state that should have been released points at per-request
state escaping its lifetime.

## Common Mochi leak sources (grep these when a trace hits framework internals)

- **Unbounded module-level caches** — `packages/mochi/src/compiler/compileCache.ts`,
  `preprocessCache.ts`, `cache/cache-storage.ts`, `islands/islandPropsRegistry.ts`.
  A cache keyed by per-request data with no eviction grows forever.
- **Event-bus / listener accumulation** — `mochiEvents` subscriptions (`events.ts`,
  `dev/consoleLogger.ts`) and the SSE/WS handler sets in `Mochi.ts`. A subscribe with no
  matching off, or a connection set that isn't pruned on close.
- **Per-request state outliving the request** — the `AsyncLocalStorage` context in
  `runtime/requestContext.ts`, rate-limit maps in `runtime/rateLimit.ts`, `runtime/warmup.ts`.
- **Growing arrays** — `ComponentRegistry.errors` and similar append-only buffers.

Confirm empirically — reproduce the growth with a minimal repro before claiming a root cause
(project rule); a trace is a strong lead, not proof.

## Guardrails

- **Never auto-commit or auto-fix.** Propose the fix and wait for the user to approve (repo rule).
- After any code change, **delegate `bun run checks`** to a sub-agent (don't run it in the main context).
- `./snapshots/` and `.memtest-out/` are gitignored — nothing here gets committed.
- Kill stray `bun`/`node` processes when done.
