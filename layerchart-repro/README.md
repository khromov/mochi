# layerchart-repro

Standalone reproduction of a Svelte SSR-compiler bug where a prop and a same-named `{#snippet}`
collide, and the server compiler resolves the guarded reference to the snippet (→ infinite recursion)
while the client resolves it to the prop. It surfaces as **every LayerChart chart shortcut crashing
under `ssr`**. Full write-up in [`BUG_REPORT.md`](./BUG_REPORT.md).

Runnable with just Bun + Svelte — no Mochi, no bundler config. The harness (`harness.ts`) does the
same three steps a framework would: compile `.svelte` with `svelte/compiler`, bundle with
`Bun.build()`, render with `svelte/server`.

## Run

```sh
bun install          # not needed if run from inside the monorepo (deps resolve from the root)
bun reproduce-svelte.ts       # minimal pattern (Svelte only): server crash + the server/client compile diff
bun reproduce-layerchart.ts   # all six LayerChart shortcuts crashing under ssr
```

## Files

- `pattern/Outer.svelte`, `pattern/Inner.svelte` — the minimal prop/snippet name collision.
- `reproduce-svelte.ts` — compiles the pattern for both targets, prints the divergent output, then
  server-renders it (crashes).
- `reproduce-layerchart.ts` — server-renders each LayerChart shortcut with `ssr` (all crash).
- `harness.ts` — the Bun + Svelte compile/build/render harness.

`.out/` is scratch build output and can be deleted.
