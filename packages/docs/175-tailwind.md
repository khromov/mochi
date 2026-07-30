---
title: 'Tailwind'
slug: tailwind
description: 'Integrate Tailwind CSS v4 into a Mochi app with the setupTailwind helper.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Tailwind

<Callout type="warning">

Experimental — the `mochi-framework/tailwind` API may change.

</Callout>

Drive Tailwind v4 with its Node API. Mochi ships an opt-in helper at `mochi-framework/tailwind` that compiles your input CSS at server startup and re-runs on file changes in dev. Then `import` the generated file from any `.svelte` and Mochi's [CSS-import bundler](/docs/css-imports/) links it scoped to the page.

### Setup

1. Install Tailwind alongside its Node and scanner packages:

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

3. Call `setupTailwind` at module scope in `src/index.ts`, before `Mochi.serve()`. Top-level `await` ensures the generated CSS exists for both the build CLI and the dev server:

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

The bundler strips the import from the JS bundle and serves the CSS at `/_mochi/import-css/<hash>.css`. The `<link>` is added to every page that transitively imports it. Pages that do not reference it ship no Tailwind. See [CSS imports](/docs/css-imports/).

### `setupTailwind` options

| Option   | Default              | Meaning                                                        |
| -------- | -------------------- | -------------------------------------------------------------- |
| `input`  | —                    | Path to the input CSS (`@import`s and `@source` rules).        |
| `output` | —                    | Path where the generated CSS is written, stable for `import`.  |
| `base`   | directory of `input` | Anchors `@source` patterns.                                    |
| `minify` | `false`              | Minify the optimised output. Set from `process.env.MODE`.      |

<Callout type="info">

`@source` paths resolve against `base`. `./*.svelte` matches files next to `app.css` only. Use `**/*.svelte` for nested folders.

</Callout>

### Dev rebuilds

In development, `setupTailwind` subscribes to `file:change` on `mochiEvents` and rebuilds on `.svelte` / `.ts` / `.js` / `.html` / `.md` / `.svx` / `.css` changes. The resulting write goes through Mochi's CSS fast-path — a stylesheet swap, not a full SSR rebuild. The watcher attaches only when `process.env.MODE === 'development'`.

### Production builds

`setupTailwind` static-imports `@tailwindcss/oxide`, a native module. If your production runtime image uses a different libc than the install image, the binding installed at build time fails to load at runtime and the server crashes at startup with `Cannot find native binding`.

Generate the CSS at build time and dynamic-import the helper so production never loads oxide:

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

Pair it with a prebuild script that compiles the CSS ahead of [`mochi-framework build`](/docs/cli/#build):

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

<Callout type="info">

**Guard the `mochi-framework/tailwind` import dynamically.** A static import loads the oxide native binding even when the call site is gated by `MODE`. Put the `import()` inside the development guard so the binding is never resolved in production.

</Callout>

### Preflight and resets

The example imports `tailwindcss/utilities.css` **without** `layer(utilities)`. If your shell's CSS ships an unlayered universal reset, wrapping utilities in `layer(utilities)` lets the unlayered reset clobber `.p-6`, `.mt-2`, and so on, because unlayered styles beat layered ones in the cascade.

The example also skips Tailwind's preflight so the stylesheet does not reset unrelated UI. The cost is that user-agent defaults leak through, so `<button>` keeps its rounded macOS pill shape. Add a small reset:

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

Preflight resets every element on every page that imports the stylesheet. On a multi-page site, scope your Tailwind CSS to a single page or accept that preflight resets shared chrome too.

</Callout>

<SeeItInAction
demos={[{ href: "https://demos.mochi.fast/todo/", title: "Tailwind Todo App", hook: "Classic todo app styled with Tailwind CSS." }]}
/>
