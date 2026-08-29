---
title: 'Svelte config'
slug: svelte-config
description: 'Customize the Svelte compiler through svelte.config.js with compiler options and framework defaults.'
---

<script>
  import VersionNote from './_components/VersionNote.svelte';
</script>

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

The file is optional. Mochi compiles correctly without it. If it is missing, Mochi logs `[mochi] No Svelte config found at … — using framework defaults.` and continues with the framework defaults.

Both ESM (`export default`) and CJS (`module.exports`) are supported. In dev, Mochi watches the file — an edit reloads `compilerOptions` without restarting the server.

### Framework defaults

One field is seeded before your config merges in:

| Field             | Default | Why                                                        |
| ----------------- | ------- | ---------------------------------------------------------- |
| `discloseVersion` | `false` | Suppresses the `<!-- svelte v… -->` comment in SSR output. |

Override it by setting it in your own `compilerOptions`.

### svelteConfigPath

Pass `svelteConfigPath` to `Mochi.serve()` or `build()` to load the config from somewhere else. Relative paths resolve against `process.cwd()`. Absolute paths are used as-is.

```ts
// file: src/index.ts
await Mochi.serve({
  svelteConfigPath: './configs/svelte.staging.config.js',
  routes,
});
```

### Framework-owned fields

Mochi forces four `compilerOptions` at every compile call site:

| Field                | Forced to                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generate`           | `'server'` for SSR builds, `'client'` for hydration bundles.                                                                                                                   |
| `filename`           | The actual file path being compiled.                                                                                                                                           |
| `dev`                | The `Mochi.serve()` `development` flag — **client target only**. Server compiles do not force `dev`.                                                                           |
| `experimental.async` | `true`. Mochi's own components use top-level `await`, so turning it off breaks the framework's shipped source. A config that sets it to `false` logs a warning and is ignored. |

Every other field — `runes`, `css`, `accessors`, `cssHash`, `discloseVersion` — is yours to set.

### Re-exporting Mochi's config

<VersionNote since="0.10.0" message="The mochi-framework/svelte.config.js subpath ships in the next Mochi release (0.10.0)." />

Mochi applies its own compiler options at every call site, so your app does not need a `svelte.config.js` to compile. `svelte-check` and the Svelte VS Code extension read the file themselves and know nothing about Mochi, so they reject `await` in a component unless the file enables it. Re-export the framework's own config to keep them in sync:

```js
// file: svelte.config.js
export { default } from 'mochi-framework/svelte.config.js';
```

Add your own options by spreading it:

```js
// file: svelte.config.js
import mochiConfig from 'mochi-framework/svelte.config.js';

export default {
  compilerOptions: {
    ...mochiConfig.compilerOptions,
    runes: true,
  },
};
```

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
