# svelte-repro

Minimal, **Svelte-only** reproduction (no bundler, no LayerChart, no framework) of a
server-vs-client compiler divergence: a `{#snippet}` whose name collides with a same-named prop is
resolved to the **prop** by the client compiler but **shadowed by the snippet itself** by the server
compiler — producing unbounded recursion (`RangeError: Maximum call stack size exceeded`) on every
server render.

Depends on `svelte` alone. `reproduce.mjs` compiles the components with `svelte/compiler` and renders
with `svelte/server` — no `Bun.build`, no Vite. Runs under Bun or Node.

## Run

```sh
bun install        # not needed if run from inside the monorepo (svelte resolves from the root)
bun reproduce.mjs  # or: node reproduce.mjs
```

## What it prints

1. The same `Outer.svelte` compiled for `server` (a `marks` function that calls itself) vs `client`
   (the guard compiles to `$$props.marks(...)`, i.e. the prop).
2. An actual server render → `CRASH → RangeError: Maximum call stack size exceeded.`

## The components

`Outer.svelte` declares a `marks` **prop** and passes a same-named `{#snippet marks}` to a child,
guarding with `{#if typeof marks === 'function'}` — the intent being "render the caller's `marks` if
given, else default". `Inner.svelte` just renders the snippet it receives.

```svelte
<!-- Outer.svelte -->
<script>
  import Inner from './Inner.svelte';
  let { marks } = $props();
</script>
<Inner>
  {#snippet marks({ value })}
    {#if typeof marks === 'function'}
      {@render marks({ value })}
    {:else}
      <p>default content: {value}</p>
    {/if}
  {/snippet}
</Inner>
```

Full write-up (and the LayerChart real-world impact) in `../layerchart-repro/BUG_REPORT.md`.

`.out/` is scratch compile output and can be deleted.
