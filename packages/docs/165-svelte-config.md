---
title: 'Svelte config'
slug: svelte-config
description: 'Customize the Svelte compiler via svelte.config.js with compiler options and framework defaults.'
---

## Svelte config

Mochi loads `./svelte.config.js` from the cwd at startup and merges its `compilerOptions` into the framework defaults. Drop the file at the root of your app to customize the Svelte compiler.

```js
// file: svelte.config.js
export default {
  compilerOptions: {
    runes: true,
  },
};
```

The file is optional — Mochi compiles correctly without it. If it is missing, Mochi logs `[mochi] No Svelte config found at … — using framework defaults.` and continues with `FRAMEWORK_COMPILER_DEFAULTS`.

Both ESM (`export default`) and CJS (`module.exports`) are supported. In dev, the file is watched — edits trigger a reload of `compilerOptions` without restarting the server.

### Editor and svelte-check support

`svelte-check` and the Svelte VS Code extension read `svelte.config.js` themselves and know nothing about Mochi's defaults, so without the file they reject `await` in components even though Mochi compiles them fine. Ship the file for their benefit, re-exporting Mochi's own:

```js
// file: svelte.config.js
export { default } from 'mochi-framework/svelte.config.js';
```

Add your own `compilerOptions` by spreading it instead:

```js
// file: svelte.config.js
import mochi from 'mochi-framework/svelte.config.js';

export default {
  compilerOptions: {
    ...mochi.compilerOptions,
    runes: true,
  },
};
```

### Framework defaults

One field is seeded before your config is merged in:

| Field             | Default | Why                                                        |
| ----------------- | ------- | ---------------------------------------------------------- |
| `discloseVersion` | `false` | Suppresses the `<!-- svelte v… -->` comment in SSR output. |

It can be overridden by setting it in your own `compilerOptions`.

### svelteConfigPath

Pass `svelteConfigPath` to `Mochi.serve()` or `build()` to load the config from somewhere other than `./svelte.config.js`. Relative paths resolve against `process.cwd()`; absolute paths are used as-is.

```ts
// file: src/index.ts
await Mochi.serve({
  svelteConfigPath: './configs/svelte.staging.config.js',
  routes,
});
```

### Framework-owned fields

Four `compilerOptions` are forced by Mochi at every compile call site and cannot be overridden — they are part of the framework's contract with the compiler:

| Field                | Forced to                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generate`           | `'server'` for SSR builds, `'client'` for hydration bundles.                                                                                                             |
| `filename`           | The actual file path being compiled.                                                                                                                                     |
| `dev`                | The `Mochi.serve()` `development` flag — **client target only**. Server compiles do not force `dev`, so set it explicitly in `compilerOptions` if you need it.           |
| `experimental.async` | `true`. Mochi's own components use top-level `await`, so turning it off would break the framework's shipped source. Setting it to `false` logs a warning and is ignored. |

Every other field — `runes`, `css`, `accessors`, `cssHash`, `discloseVersion`, etc. — is yours to set.

### Where it applies

The merged options are used everywhere Mochi invokes the Svelte compiler:

- SSR compilation of `.svelte` files
- SSR compilation of `.svelte.js` / `.svelte.ts` rune modules
- Client-side island bundles (both `.svelte` and `.svelte.[jt]s`)
- mdsvex `.md` / `.svx` files (server target)

These options reach whichever compiler backend is active. Under `svelteCompiler: 'rsvelte'`, the function-valued `cssHash` and `warningFilter` are stripped with a warning — see `rsvelte compiler`.

### What is not read

Only `compilerOptions` is honored. SvelteKit-style top-level keys are ignored:

- `preprocess` — register preprocessors via the `compile:preprocessors` filter on the extensions API instead, not in `svelte.config.js`.
- `extensions` — Mochi's accepted extensions are fixed (`.svelte`, `.svelte.[jt]s`, `.md`, `.svx`). Adding `.svx` to `extensions` here has no effect; it is already wired into the mdsvex loader.
- `kit` — SvelteKit-only; ignored.
