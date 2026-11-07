# @mochi-framework/rsvelte

Opt-in [rsvelte](https://github.com/baseballyama/rsvelte) backend for `mochi-framework`.
rsvelte is a Rust port of the Svelte 5 compiler built on [OXC](https://oxc.rs/); this package
adapts it to Mochi's compiler-backend contract so component compilation runs natively instead
of through the JavaScript `svelte/compiler`.

## Install

```sh
bun add -d @mochi-framework/rsvelte
```

## Use

```ts
await Mochi.serve({
  svelteCompiler: 'rsvelte',
  routes,
});
```

Or without touching code — the env var wins over the option, which is handy for A/B timing an
existing app:

```sh
MOCHI_SVELTE_COMPILER=rsvelte bun run build
```

If this package isn't installed (or its native binary won't load on the current platform),
Mochi logs a warning and falls back to `svelte/compiler`. Builds never fail over it.

## What is and isn't swapped

Only `compile()` and `compileModule()` run on rsvelte. Mochi's island preprocessor walks a real
Svelte AST with `zimmerframe`, and rsvelte's `parse()` returns a JSON string rather than an
upstream-shaped AST — so **parsing and preprocessing always stay on the official compiler**.
The output rsvelte emits is verified byte-identical to upstream by this package's test suite.

## Caveats

- **Pre-1.0.** rsvelte's own README warns that APIs and behaviour may change without notice.
- **Function-valued compiler options are ignored.** `cssHash` and `warningFilter` cannot cross
  the native boundary. `cssHash` is stripped with a one-time warning; use rsvelte's
  `cssHashOverride: '<hash>'` to force a fixed value. `warningFilter` is dropped silently, since
  Mochi never surfaces compiler warnings, so it keeps working for `svelte-check` and editors.
- **`$derived(await …)` in dev client builds** loses Svelte's dev-only reactivity-loss
  instrumentation. Server output and non-dev client output match upstream byte-for-byte.
- **`compileModule()` output differs cosmetically** — a `vVERSION` placeholder in the generated
  header comment and different printer whitespace. Semantically identical.
- **Platforms.** Prebuilt binaries cover macOS arm64/x64, Linux x64/arm64 (glibc) and Windows
  x64 (MSVC). There is no musl build, so Alpine-based images fall back to `svelte/compiler`.
- **Windows needs the Visual C++ Redistributable.** The prebuilt `.node` links against
  `VCRUNTIME140.dll`, which Windows does not ship in the box. Without it the binding fails with
  `LoadLibrary failed: The specified module could not be found` — the file is present, its C
  runtime is not. Install it with `winget install --id Microsoft.VCRedist.2015+.x64 -e`. GitHub's
  `windows-latest` runners already have it.
- **Switching backends invalidates compiled output.** Mochi's in-memory compile cache is keyed
  on the backend, but a prebuilt `manifest.json` is not — run `bun run clean` and rebuild after
  changing `svelteCompiler`.
