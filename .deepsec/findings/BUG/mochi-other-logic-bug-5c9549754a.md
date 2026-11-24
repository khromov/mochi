# [BUG] svelteConfigPath is unreachable from the build CLI, so production artifacts can be compiled with the wrong Svelte config

**File:** [`packages/mochi/src/cli/cli.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/cli.ts#L146-L219) (lines 146, 219)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`Mochi.serve({ svelteConfigPath })` is a documented serve option (`types.ts`: "Path to a Svelte config file … Its `compilerOptions` merge into Mochi's defaults"), and `build()` accepts a matching `svelteConfigPath` (build.ts L38-39, consumed at L146). The CLI bridges neither: `parseArgs` declares no `--svelte-config` flag (L139-149), and the `build({...})` call (L219-236) forwards `markdown`, `svelteCompiler`, `optimize`, `minifier`, `barrelWarnings`, `fonts`, `errorPage`, `resources`, `protection` and `publicDir` from the captured serve options — but not `svelteConfigPath`. `build()` therefore always calls `loadSvelteConfig(undefined)`, which resolves `./svelte.config.js` from the cwd.

Failure scenario: an app sets `Mochi.serve({ svelteConfigPath: './config/svelte.config.js' })` with no `./svelte.config.js` present. `bun run dev` compiles through `Mochi.serve()` and honours the config; `mochi-framework build` loads nothing and bakes framework-default `compilerOptions` into the prebuilt manifest. Production then runs those artifacts without recompiling (`fromManifest`), so any `compilerOptions` the project depends on — `css`, `customElement`, `warningFilter`, runes settings — silently do not apply in prod while working in dev. The option is simply unusable from the CLI; the only way to reach it is calling `build()` programmatically. `loadSvelteConfig` does emit "No Svelte config found at <cwd>/svelte.config.js — using framework defaults", which makes the mismatch noisy rather than wholly silent, so this is a bug rather than a security issue.

## Recommendation

Forward it the same way `publicDir` already is — `svelteConfigPath: values['svelte-config'] ?? serveOptions?.svelteConfigPath` — and add a `--svelte-config <path>` flag plus a HELP/docs entry. (`outDir` is deliberately *not* mirrored, since the relocatable-build workflow depends on build and runtime out-dirs being independent; `assetPrefix` mismatches are already detected and warned about at boot.)

## Revalidation

**Verdict:** true-positive

Verified end to end. `svelteConfigPath` is a real, documented serve option (types.ts L608-612; docs/160-serve-options.md L74; docs/165-svelte-config.md L37-44 says explicitly 'Pass `svelteConfigPath` to `Mochi.serve()` or `build()` to load the config from somewhere else'), and `build()` accepts it (build.ts L38-39) and consumes it at L146. The CLI bridges neither half: `parseArgs` (cli.ts L139-149) declares `entry`, `out-dir`, `public-dir`, `asset-prefix`, `minifier`, `dev`, `force` and nothing else, and the `build({...})` call (L219-236) forwards markdown, svelteCompiler, optimize, minifier, barrelWarnings, fonts, errorPage, resources, protection, publicDir and assetPrefix — but not `svelteConfigPath`. A repo-wide grep for the identifier confirms the only consumers are types.ts, build.ts and Mochi.ts:580; nothing in cli.ts touches it. So `build()` always calls `loadSvelteConfig(undefined)`, which resolves `path.resolve('svelte.config.js')` from the cwd (svelteConfig.ts L22). The divergence claim is correct too: `Mochi.serve()` honours the option at Mochi.ts:580, and production with a prebuilt manifest takes the `fromManifest` branch (Mochi.ts L562-566) and never recompiles, so `compilerOptions` such as `css`, `customElement`, `warningFilter` or runes settings apply in dev and silently do not in prod. The CLI's own `--help` ('The build reads its config straight from the entry's `Mochi.serve()` call, so the prebuilt manifest stays single-sourced with the runtime') makes the omission a contract violation rather than an undocumented gap. Correctly rated a bug rather than a security issue, since `loadSvelteConfig` logs 'No Svelte config found at … — using framework defaults' (L24), making the mismatch noisy. The recommendation's parenthetical about `outDir` being deliberately unmirrored is also accurate.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
