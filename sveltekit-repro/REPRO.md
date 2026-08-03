# sveltekit-repro

A stock SvelteKit app (scaffolded with `npx sv create --template minimal --types ts`) that reproduces
the Svelte SSR snippet/prop name-collision bug end-to-end — no custom harness, no LayerChart. This is
the most "real" confirmation: an unmodified SvelteKit page fails to server-render.

- `src/lib/Inner.svelte` — renders the `marks` snippet it's given.
- `src/lib/Outer.svelte` — declares a `marks` **prop** and passes a same-named `{#snippet marks}` to
  `<Inner>`, guarded by `{#if typeof marks === 'function'}`.
- `src/routes/+page.svelte` — renders `<Outer />`; SvelteKit server-renders it by default.

## Reproduce

```sh
npm install

# dev SSR
npm run dev
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/   # → 500

# production SSR
npm run build && npm run preview
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/   # → 500
```

## Result — both modes 500

The server console shows the `marks` snippet recursing into itself (`at marks (src/lib/Outer.svelte:12…)`,
the `{@render marks(...)}` line, repeated):

- **dev** → `TypeError: undefined is not a function` (the deep self-recursion dies in dev instrumentation)
- **production** → `RangeError: Maximum call stack size exceeded`

The same component renders fine in the browser (client build). Root-cause write-up and the minimal
Svelte-only / Vite versions live in `../layerchart-repro/BUG_REPORT.md`, `../svelte-repro/`,
`../vite-repro/`.
