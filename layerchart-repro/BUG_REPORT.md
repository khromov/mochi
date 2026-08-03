# Server compiler turns a prop/snippet name collision into unbounded recursion

## Summary

When a component has a **prop** and a **`{#snippet}`** with the **same name**, and the snippet
guards on that name with `{#if typeof name === 'function'}`, Svelte's **server** and **client**
compilers resolve the identifier differently:

- **Client:** the guarded reference binds to the **prop** (`$$props.name`) — the guard works.
- **Server:** the guarded reference is **shadowed by the snippet itself**, so `typeof name === 'function'`
  is always true and the snippet renders itself → **infinite recursion → `RangeError: Maximum call
  stack size exceeded`** on every server render.

This is a real-world bug: it makes **all six of LayerChart's all-in-one chart components**
(`BarChart`, `AreaChart`, `LineChart`, `ScatterChart`, `PieChart`, `ArcChart`) crash the moment they
are server-rendered (`ssr` / SSR / SSG).

## Environment

- svelte `5.56.8`
- layerchart `2.0.3` (real-world trigger; not required for the minimal repro)
- Reproduces on any Svelte SSR toolchain — confirmed with a bare `svelte/compiler` + `svelte/server`
  script (bun `1.3.14` and node `24`) **and** with **Vite `8.2.0` + `@sveltejs/vite-plugin-svelte`
  `7.2.0`** (the SvelteKit toolchain). Not Bun-specific.

## Where it reproduces

| Toolchain | Result |
| --- | --- |
| `svelte/compiler` (`generate: 'server'`) + `svelte/server`, prod | `RangeError: Maximum call stack size exceeded` |
| Vite + `@sveltejs/vite-plugin-svelte`, prod (`dev: false`) | `RangeError: Maximum call stack size exceeded` |
| Vite + `@sveltejs/vite-plugin-svelte`, dev (`dev: true`) | `invalid_snippet_arguments` |
| SvelteKit (`sv create` minimal), prod (`npm run preview`) | HTTP 500 — `RangeError: Maximum call stack size exceeded` |
| SvelteKit (`sv create` minimal), dev (`npm run dev`) | HTTP 500 — recursion dies as `TypeError: undefined is not a function` |
| client build (any) | renders fine — no error |

In **dev** mode the crash surfaces earlier as `invalid_snippet_arguments`: Svelte's dev runtime
notices the snippet is being invoked as a plain function rather than via `{@render}` — which is itself
evidence that the server compiler wired the self-call incorrectly. In **prod** mode there is no such
guard, so it recurses until the stack overflows.

## Minimal reproduction (Svelte only, no LayerChart)

`pattern/Outer.svelte` — the exact shape LayerChart's shortcuts use:

```svelte
<script lang="ts">
  import Inner from './Inner.svelte';
  // consumer-facing prop: pass a snippet to override the default rendering
  let { marks }: { marks?: any } = $props();
</script>

<Inner>
  {#snippet marks({ value }: { value: number })}
    {#if typeof marks === 'function'}
      {@render marks({ value })}
    {:else}
      <p>default content: {value}</p>
    {/if}
  {/snippet}
</Inner>
```

`pattern/Inner.svelte`:

```svelte
<script lang="ts">
  let { marks }: { marks: any } = $props();
</script>
{@render marks({ value: 1 })}
```

Run:

```sh
bun install
bun reproduce-svelte.ts      # the pattern above — server crash + the compiled-output diff
bun reproduce-layerchart.ts  # all six LayerChart shortcuts crashing under ssr
```

## Root cause — the two compilers disagree

`compile(Outer.svelte, { generate: 'server' })` emits a snippet that **shadows the prop and calls
itself**:

```js
let { marks } = $$props;
{
  function marks($$renderer, { value }) {
    if (typeof marks === 'function') {   // `marks` === this function → always true
      marks($$renderer, { value });      // ← calls itself → infinite recursion
    } else {
      $$renderer.push(`<p>default content: ${$.escape(value)}</p>`);  // dead code on the server
    }
  }
  Inner($$renderer, /* marks */ ...);
}
```

`compile(Outer.svelte, { generate: 'client' })` binds the guarded call to the **prop** instead:

```js
marks = ($$anchor, $$arg0) => {
  ...
  var consequent = ($$anchor) => {
    $$props.marks($$anchor, () => ({ value: value() }));  // ← the PROP, not the snippet
  };
  var alternate = ($$anchor) => { /* default content */ };
};
```

So the identical source produces a self-recursive snippet on the server and a correct, prop-delegating
one on the client.

## Expected vs. actual

- **Expected:** both targets resolve `marks` inside `{#snippet marks}` the same way (and, matching the
  client, to the prop — so the `typeof` guard can delegate to a caller-supplied snippet). At minimum,
  a name collision that changes semantics between targets should be a compile-time error, not silent
  divergence.
- **Actual:** the server target silently shadows the prop with the snippet and recurses forever.

## Impact

Every LayerChart chart shortcut uses this pattern (`components/charts/*/*.base.svelte`, the
`{#snippet marks}` + `{#if typeof marks === 'function'}` block), so none of them can be
server-rendered:

```
BarChart      → CRASH — RangeError: Maximum call stack size exceeded.
AreaChart     → CRASH — RangeError: Maximum call stack size exceeded.
LineChart     → CRASH — RangeError: Maximum call stack size exceeded.
ScatterChart  → CRASH — RangeError: Maximum call stack size exceeded.
PieChart      → CRASH — RangeError: Maximum call stack size exceeded.
ArcChart      → CRASH — RangeError: Maximum call stack size exceeded.
```

(The crash only fires once the render is actually materialised — `svelte/server`'s `render()` is lazy,
so the recursion happens when `.body` is read.)

## Notes for each project

- **Svelte:** the server/client divergence on a prop/snippet name collision looks like the underlying
  bug — the two targets should agree, or reject the collision at compile time.
- **LayerChart:** independent of the Svelte fix, renaming the internal snippet so it no longer collides
  with the `marks` prop (e.g. `{#snippet defaultMarks(...)}` while the guard keeps testing the `marks`
  prop) sidesteps the shadowing and restores SSR for all the shortcut charts.
