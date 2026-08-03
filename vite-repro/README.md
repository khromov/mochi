# vite-repro

Reproduces the same Svelte SSR snippet/prop name-collision bug through a **real Vite +
`@sveltejs/vite-plugin-svelte` pipeline** — the canonical toolchain SvelteKit is built on. This rules
out Bun/Mochi entirely: the crash comes from the Svelte plugin's SSR compile, not any custom harness.

`reproduce.mjs` spins up a Vite server, `ssrLoadModule`s `Outer.svelte` (which compiles it with the
Svelte server target), and renders it with `svelte/server`.

## Run

```sh
bun install        # or npm install / pnpm install
node reproduce.mjs
```

## Result

Both modes fail to server-render — same root cause, different symptom:

```
dev build  (dev: true)  → CRASH → Error: invalid_snippet_arguments
prod build (dev: false) → CRASH → RangeError: Maximum call stack size exceeded
```

- **prod (`dev: false`)** is the raw bug: the server-compiled `{#snippet marks}` shadows the `marks`
  prop and calls itself → infinite recursion.
- **dev (`dev: true`)** is the *same* miscompile, but Svelte's dev-mode runtime notices the snippet is
  being invoked as a plain function (not via `{@render}`) and throws `invalid_snippet_arguments`
  before it can recurse — itself a signal that the server compiler wired the call wrong.

The identical component renders fine in the browser (client build). Root-cause write-up:
`../layerchart-repro/BUG_REPORT.md`; minimal Svelte-only version: `../svelte-repro/`.
