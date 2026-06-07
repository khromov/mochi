---
title: 'Tailwind'
slug: tailwind
description: 'Integrate Tailwind CSS v4 into a Mochi app using the setupTailwind helper.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Tailwind

<Callout type="warning">

Experimental — `mochi-framework/tailwind` API may change.

</Callout>

Drive Tailwind v4 with its Node API — no PostCSS, no Vite. Mochi ships an opt-in helper at `mochi-framework/tailwind` that compiles your input CSS at server startup and re-runs on file changes in dev. Then `import` the generated file from any `.svelte` and Mochi's [CSS-import bundler](/docs/css-imports/) links it scoped to the page.

### Setup

1. Install Tailwind alongside its Node + scanner packages. They are optional peers of `mochi-framework`:

```sh
bun add tailwindcss @tailwindcss/node @tailwindcss/oxide
```

2. Write an input CSS that imports the layers you want and tells Tailwind where to scan:

```css
/* file: src/styles/app.css */
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css';

@source './*.svelte';
```

3. Call `setupTailwind` at module scope in your `src/index.ts`, before `Mochi.serve()` runs. Top-level `await` ensures the generated CSS exists for both the build CLI and the dev server:

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';
import { setupTailwind } from 'mochi-framework/tailwind';

await setupTailwind({
  input: './src/styles/app.css',
  output: './src/styles/app.generated.css',
  minify: process.env.MODE !== 'development',
});

await Mochi.serve({
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

4. `import` the generated file from any `.svelte` that uses Tailwind classes:

```svelte
<!-- file: src/Home.svelte -->
<script>
  import './styles/app.generated.css';
</script>

<button class="rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700">Click</button>
```

5. Add `app.generated.css` to `.gitignore` — it is a build artifact.

The bundler strips the import from the JS bundle and serves the CSS at `/_mochi/import-css/<hash>.css`. The `<link>` is added to the `<head>` of every page that transitively imports it; pages that don't reference it ship no Tailwind. See `CSS imports` for the full mechanism.

### `setupTailwind` options

| Option   | Default              | Meaning                                                                         |
| -------- | -------------------- | ------------------------------------------------------------------------------- |
| `input`  | —                    | Path to the input CSS (`@import`s and `@source` rules).                         |
| `output` | —                    | Path where the generated CSS is written. Stable so a `.svelte` can `import` it. |
| `base`   | directory of `input` | Anchors `@source` patterns. Override when sources live elsewhere.               |
| `minify` | `false`              | Minify the optimised output. Set from `process.env.MODE`.                       |

<Callout type="info">

`@source` paths resolve against `base`. `./*.svelte` matches files next to `app.css` only — use `**/*.svelte` for nested folders, or pass an explicit `base`.

</Callout>

### Dev rebuilds

In development, `setupTailwind` subscribes to `file:change` on `mochiEvents` and rebuilds on `.svelte` / `.ts` / `.js` / `.html` / `.md` / `.svx` / `.css` changes. The resulting `.css` write goes through Mochi's CSS fast-path — no full SSR rebuild, just a stylesheet swap.

The watcher only attaches when `process.env.MODE === 'development'`.

### Production builds

`setupTailwind` static-imports `@tailwindcss/oxide`, a native module. If your production runtime image uses a different libc than the install image (e.g. install on Debian/glibc, runtime on Alpine/musl), the gnu binding installed at build time won't load at runtime and the server crashes at startup with `Cannot find native binding`.

If you generate the CSS at build time, dynamic-import the helper so production never loads oxide:

```ts
// file: src/index.ts
if (process.env.MODE === 'development') {
  const { setupTailwind } = await import('mochi-framework/tailwind');
  await setupTailwind({
    input: './src/styles/app.css',
    output: './src/styles/app.generated.css',
  });
}
```

Pair it with a prebuild script that compiles the CSS ahead of `mochi-framework build`:

```ts
// file: scripts/prebuild.ts
import { compileTailwind } from 'mochi-framework/tailwind';

await compileTailwind({
  input: './src/styles/app.css',
  output: './src/styles/app.generated.css',
  minify: true,
});
```

```json
"scripts": {
  "build": "bun scripts/prebuild.ts && mochi-framework build"
}
```

Do **NOT** static-import `mochi-framework/tailwind` and gate only the call site with `process.env.MODE === 'development'` — the runtime branch is skipped, but the static import already loaded oxide. Instead, put the dynamic `import()` inside the guard so the native binding is never resolved in production.

### Preflight and resets

The example imports `tailwindcss/utilities.css` **without** `layer(utilities)`. If your shell's CSS already ships an unlayered universal reset (e.g. `*, *::before, *::after { margin: 0; padding: 0 }`), wrapping utilities in `layer(utilities)` lets the unlayered reset clobber `.p-6`, `.mt-2`, etc., because unlayered styles always beat layered ones in the cascade.

Do **NOT** wrap utilities in `layer(utilities)` when your shell ships an unlayered reset; instead, leave them unlayered so selector specificity wins.

The example also skips Tailwind's preflight so the stylesheet doesn't reset unrelated UI on pages that already have their own resets. The cost is that user-agent defaults leak through — `<button>` keeps its rounded macOS pill shape and clobbers utilities like `rounded-lg` or `bg-transparent`.

```css
/* file: src/styles/app.css */
button {
  appearance: none;
  background: transparent;
  border: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
```

To opt back in, `@import 'tailwindcss/preflight.css' layer(base);`.

<Callout type="warning">

Preflight resets every element on every page that imports the stylesheet. On a multi-page site, scope your Tailwind CSS to a single page (only that `.svelte` imports it) or accept that preflight will reset shared chrome too.

</Callout>
