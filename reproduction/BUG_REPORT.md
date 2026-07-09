# Bug report: `AsyncLocalStorage` context lost under concurrent async work (Bun 1.4.0)

## 1. Steps to reproduce

```sh
bun reproduction/repro.mjs
```

The script (no dependencies, only `node:async_hooks`) models Svelte 5's async SSR renderer:
promise `.then()` continuation chains that restore a module variable and rely on the runtime
to keep `AsyncLocalStorage` propagated. It runs many `als.run()`-scoped chains concurrently
with un-scoped churn chains (the churn is not required to trigger the bug — it just makes the
failure show up early and reliably, see §4), then asserts every scoped chain still sees its
own store.

Compare across versions:

```sh
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.14"   # last good
bun upgrade --canary                                          # back to 1.4.0
```

## 2. Expected behavior

Inside `als.run(store, fn)`, `als.getStore()` returns that `store` for the entire async
lifetime of `fn` — including across `.then()` continuations — regardless of unrelated
concurrent async work. Output: `PASS`.

## 3. What happens instead

On Bun 1.4.0 the store is dropped mid-chain: `als.getStore()` returns `undefined` (never a
different chain's store — it is dropped, not crossed) for the majority of scoped renders.
Output: `FAIL: 3200/3200 scoped renders LOST their AsyncLocalStorage context` (the warmup
probes until the one-way cliff is crossed, so the failure is deterministic). Bun 1.3.14
prints `PASS`, as does Node (v24 checked) on the identical script.

## 4. Additional information

- **Trigger conditions:** needs manual `.then()` chaining — plain `async`/`await`,
  `Promise.all`, `Bun.sleep`, and timers all propagate correctly (an `await`-based rewrite of
  the same chain passes every run). Concurrency is **not** required: a fully sequential loop
  that runs one scoped chain at a time also trips it, just later and less reliably per run.
- **Onset is a one-way cliff, then permanent.** Propagation works for the first N chains
  (N varies run to run, observed ~500–13000 sequential iterations — JIT-tier-up/GC-timing
  shaped), then the first drop occurs and **every subsequent `als.run()` chain in the process
  loses its store** — zero recoveries observed over 20k iterations. The repro's un-scoped
  churn chains exist only to generate promise-reaction volume so the cliff is crossed early,
  making the script fail near-deterministically.
- **Not just our code — it breaks Svelte itself.** Svelte 5's server renderer tracks its
  render context with its own `AsyncLocalStorage`
  (`svelte/src/internal/server/render-context.js:16`, `get_render_context()` reads
  `context ?? als.getStore()`). Under Bun 1.4.0 that `getStore()` returns `undefined` in async
  continuations, so `hydratable()` and other async-SSR features throw
  `server_context_required` mid-render. Any framework storing per-request state in
  `AsyncLocalStorage` during Svelte SSR is affected.
- **Real-world symptom:** in [mochi-framework](../packages/mochi), a Svelte page that renders
  async (a top-level `await` in the `<script>`) plus concurrent async image work throws
  `getRequestContext() called outside of a request.` during SSR — a sticky 500: once the
  process crosses the cliff, every later request fails too.
- **Environment:** macOS arm64 (Darwin 25.5.0); Bun `1.4.0-canary.1+b05b4fab0`; Svelte
  `5.56.4`. Regression is between Bun 1.3.14 (good) and 1.4.0.
