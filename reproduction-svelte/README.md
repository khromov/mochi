# Svelte async-SSR × Bun 1.4.0 `AsyncLocalStorage` regression

A **Svelte-only** reproduction — no framework, no user `AsyncLocalStorage`. It shows that Bun
1.4.0 breaks Svelte 5's own async server-side rendering.

Svelte 5 tracks its render context in an internal `AsyncLocalStorage`
(`svelte/src/internal/server/render-context.js`): `get_render_context()` returns
`context ?? als.getStore()`, where `context` is a module variable set only during the
synchronous phase of a render. Once a component goes async (a top-level `await`, or `await` in
a `$derived`), the code after the await runs in a promise `.then()` continuation where
`context` is `null`, so Svelte relies on `als.getStore()`. `hydratable()` calls
`get_render_context()` — and under Bun 1.4.0, with concurrent async renders in flight, that
`getStore()` returns `undefined`, so Svelte throws `server_context_required`.

## Run

```sh
cd reproduction-svelte
bun install
bun start
```

The repro compiles `App.svelte` / `Card.svelte` (`generate: 'server'`, `experimental.async`),
then calls `svelte/server`'s `render()` many times concurrently (plus background renders) and
counts how many throw Svelte's `server_context_required`.

## Expected output

| Bun version | Result |
| --- | --- |
| **1.3.14** | `PASS: 320 renders OK, 0 threw server_context_required` |
| **1.4.0** | `FAIL: ~280 renders threw Svelte's server_context_required (...)` |

Switch versions to compare:

```sh
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.14"   # last good
bun upgrade --canary                                          # back to 1.4.0
```

## Relationship to the other repro

- [`../reproduction/`](../reproduction) isolates the underlying Bun bug with **zero
  dependencies** (`node:async_hooks` only) — the minimal `AsyncLocalStorage` failure.
- This folder shows the **same** regression surfacing through **core Svelte's** async SSR
  (`hydratable()` → `server_context_required`), which is why it also breaks any app that stores
  per-request state in `AsyncLocalStorage` during Svelte SSR.

Environment where observed: macOS arm64; Bun `1.4.0-canary.1`; Svelte `5.56.4`.
