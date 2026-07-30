---
title: 'Svelte config'
slug: svelte-config
description: 'Customize the Svelte compiler through svelte.config.js with compiler options and framework defaults.'
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

The file is optional. If it is missing, Mochi logs `[mochi] No Svelte config found at … — using framework defaults.` and continues with the framework defaults.

Both ESM (`export default`) and CJS (`module.exports`) are supported. In dev, Mochi watches the file — an edit reloads `compilerOptions` without restarting the server.

### Framework defaults

Two fields are seeded before your config merges in:

| Field                | Default | Why                                                                  |
| -------------------- | ------- | -------------------------------------------------------------------- |
| `experimental.async` | `true`  | Enables top-level `await` in `.svelte` components (Svelte 5 opt-in). |
| `discloseVersion`    | `false` | Suppresses the `<!-- svelte v… -->` comment in SSR output.           |

Override either by setting it in your own `compilerOptions`.

### svelteConfigPath

Pass `svelteConfigPath` to `Mochi.serve()` or `build()` to load the config from somewhere else. Relative paths resolve against `process.cwd()`; absolute paths are used as-is.

```ts
// file: src/index.ts
await Mochi.serve({
  svelteConfigPath: './configs/svelte.staging.config.js',
  routes,
});
```

### Framework-owned fields

Mochi forces three `compilerOptions` at every compile call site:

| Field      | Forced to                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `generate` | `'server'` for SSR builds, `'client'` for hydration bundles.                                         |
| `filename` | The actual file path being compiled.                                                                 |
| `dev`      | The `Mochi.serve()` `development` flag — **client target only**. Server compiles do not force `dev`. |

Every other field — `runes`, `css`, `accessors`, `cssHash`, `discloseVersion`, `experimental.*` — is yours to set.

### Where it applies

The merged options are used everywhere Mochi invokes the Svelte compiler:

- SSR compilation of `.svelte` files
- SSR compilation of `.svelte.js` / `.svelte.ts` rune modules
- Client-side island bundles
- mdsvex `.md` / `.svx` files (server target)

Under `svelteCompiler: 'rsvelte'`, the function-valued `cssHash` and `warningFilter` are stripped with a warning. See [rsvelte](/docs/rsvelte/).

### What is not read

Only `compilerOptions` is honored. SvelteKit-style top-level keys are ignored:

- `preprocess` — register preprocessors through the `compile:preprocessors` filter instead.
- `extensions` — Mochi's accepted extensions are fixed (`.svelte`, `.svelte.[jt]s`, `.md`, `.svx`).
- `kit` — SvelteKit-only.
