# Bun 1.4.0 `AsyncLocalStorage` regression

`AsyncLocalStorage.getStore()` returns `undefined` inside a promise `.then()` continuation.
The store is silently dropped mid-chain. Plain `await` / `Promise.all` / `Bun.sleep` / timers
all propagate the store correctly — the regression only shows up with the **manual `.then()`
chaining** that Svelte 5's async SSR renderer uses (`svelte/internal/server`
`renderer.run()`). Onset is a one-way cliff: propagation works for the first N chains (N
varies per run — JIT/GC-timing shaped), then the first drop occurs and **every subsequent
`als.run()` chain in the process loses its store**. Even a fully sequential loop of scoped
chains trips it eventually; concurrent context-less work (a fire-and-forget background task)
just crosses the cliff early, which is what the repro's churn chains are for.

## Run

```sh
bun reproduction/repro.mjs
```

`repro.mjs` has no dependencies (only `node:async_hooks`). It models Svelte's
`renderer.run()` thunk-chain, runs 16 un-scoped background chains concurrently with
`als.run()`-scoped chains, and asserts every scoped render still sees its own store. Node
(v24) passes the identical script.

## Expected output

| Bun version | Result                                                                |
| ----------- | --------------------------------------------------------------------- |
| **1.3.14**  | `PASS: all 3200 scoped renders kept their context`                    |
| **1.4.0**   | `FAIL: 3200/3200 scoped renders LOST their AsyncLocalStorage context` |

Switch versions to compare:

```sh
# install the last good version
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.14"
# go back to 1.4.0
bun upgrade --canary
```

## Real-world symptom

In [mochi-framework](../packages/mochi), the request context is stored in an
`AsyncLocalStorage` pinned on `globalThis`
([`requestContext.ts`](../packages/mochi/src/requestContext.ts) — see the `pinGlobal(...)`
call). Every component read of `url` / `cookies` / `params` / `locals` goes through a proxy
that calls `getRequestContext()` → `getStore()`
([codegen in `ComponentRegistry.ts`](../packages/mochi/src/ComponentRegistry.ts), the
`mochi-env` `build.onLoad` block).

On a Svelte page that renders **async** (a top-level `await` in the component `<script>`
turns on `experimental.async` SSR) and does concurrent async work — e.g. the image demo's
multiple `<Image>` async `$derived` plus the fire-and-forget `void warmImagePlaceholder(...)`
background task — Bun 1.4.0 drops the store mid-render. The next `url.pathname` read then
throws:

```
getRequestContext() called outside of a request.
```

reproduced live at `GET /demos/image/` (sticky 500 once the image cache is warm).

## It also breaks Svelte's own async SSR

This is not only a Mochi problem. Svelte 5's server renderer tracks its render context with
its **own** `AsyncLocalStorage` — `get_render_context()` reads `context ?? als.getStore()`
(`svelte/src/internal/server/render-context.js:16`), where `context` is a module variable that
is only set during the synchronous phase of a render and reset to `null` before async
continuations run. So any Svelte async-SSR feature that resolves in a continuation — notably
`hydratable()` (used to serialize server-computed values for hydration) — depends on
`als.getStore()`, and Bun 1.4.0 drops it. The symptom is Svelte's `server_context_required`
error thrown mid-render. Mochi cannot patch this from the outside. A **Svelte-only**
reproduction of this (no framework, no user `AsyncLocalStorage`) lives in
[`../reproduction-svelte/`](../reproduction-svelte).

## Fix in the consumer (partial)

Svelte also manually saves/restores its component-tree SSR context at each async boundary
(`renderer.js` `set_ssr_context`), and **that** channel survives the regression. Mochi threads
the request context through it (`render(component, { context })`) and falls back to
`getContext()` in `getRequestContext()` when the ALS store is gone. This fixes Mochi's own
request-context reads (page-level `url`/`cookies`/`params`/`locals` and the injected
`emitIslandProps()`), so pages render again.

It does **not** rescue Svelte-internal ALS use: a `mochi:hydrate` island that renders an
async `<Image placeholder>` still trips `hydratable()` → `server_context_required` on Bun
1.4.0 and degrades to its error boundary. Full correctness for that case needs the upstream
Bun fix (or pinning Bun 1.3.14).
