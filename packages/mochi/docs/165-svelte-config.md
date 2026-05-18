---
title: 'Svelte config'
slug: svelte-config
---

## Svelte config

Mochi loads `./svelte.config.js` from the cwd at startup and merges its `compilerOptions` into the framework defaults. Drop the file at the root of your app to customize the Svelte compiler.

```js
// file: svelte.config.js
export default {
  compilerOptions: {
    experimental: {
      async: true,
    },
  },
};
```

The file is optional. If it is missing, Mochi logs `[mochi] No Svelte config found at … — using framework defaults.` and continues with `FRAMEWORK_COMPILER_DEFAULTS`.

Both ESM (`export default`) and CJS (`module.exports`) are supported. In dev, the file is watched — edits trigger a reload of `compilerOptions` without restarting the server.

### Framework defaults

Two fields are seeded before your config is merged in:

| Field                | Default | Why                                                                  |
| -------------------- | ------- | -------------------------------------------------------------------- |
| `experimental.async` | `true`  | Enables top-level `await` in `.svelte` components (Svelte 5 opt-in). |
| `discloseVersion`    | `false` | Suppresses the `<!-- svelte v… -->` comment in SSR output.           |

Either can be overridden by setting it in your own `compilerOptions`.

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

Three `compilerOptions` are forced by Mochi at every compile call site and cannot be overridden — they are part of the framework's contract with the compiler:

| Field      | Forced to                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate` | `'server'` for SSR builds, `'client'` for hydration bundles.                                                                                                   |
| `filename` | The actual file path being compiled.                                                                                                                           |
| `dev`      | The `Mochi.serve()` `development` flag — **client target only**. Server compiles do not force `dev`, so set it explicitly in `compilerOptions` if you need it. |

Every other field — `runes`, `css`, `accessors`, `cssHash`, `discloseVersion`, `experimental.*`, etc. — is yours to set.

Do **NOT** set `generate` or `filename` in your config; the merge step overwrites them on every compile.

### Where it applies

The merged options are used everywhere Mochi invokes the Svelte compiler:

- SSR compilation of `.svelte` files
- SSR compilation of `.svelte.js` / `.svelte.ts` rune modules
- Client-side island bundles (both `.svelte` and `.svelte.[jt]s`)
- mdsvex `.md` / `.svx` files (server target)

### What is not read

Only `compilerOptions` is honored. SvelteKit-style top-level keys are ignored:

- `preprocess` — register preprocessors via the `compile:preprocessors` filter on the extensions API instead, not in `svelte.config.js`.
- `extensions` — Mochi's accepted extensions are fixed (`.svelte`, `.svelte.[jt]s`, `.md`, `.svx`). Adding `.svx` to `extensions` here has no effect; it is already wired into the mdsvex loader.
- `kit` — SvelteKit-only; ignored.

Do **NOT** put a `preprocess` array in `svelte.config.js` and expect it to run; instead, expose preprocessors through a Mochi extension and the `compile:preprocessors` filter.
