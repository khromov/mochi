import { compile as rsCompile, compileModule as rsCompileModule, VERSION as RSVELTE_TARGET_VERSION } from '@rsvelte/vite-plugin-svelte-native';
import type { SvelteCompileOutput, SvelteCompilerBackend } from 'mochi-framework';

/**
 * Options that are functions in `svelte/compiler` but cannot cross the NAPI
 * boundary. rsvelte accepts and silently ignores them; we strip them and say so
 * once, so a `svelte.config.js` that sets one doesn't fail quietly.
 */
const UNSUPPORTED_FUNCTION_OPTIONS = ['cssHash', 'warningFilter'] as const;

const warned = new Set<string>();

function warnOnce(option: string, detail: string): void {
  if (warned.has(option)) {
    return;
  }
  warned.add(option);
  console.warn(`[mochi-rsvelte] compilerOptions.${option}() cannot cross the native boundary and is ignored. ${detail}`);
}

/**
 * `mergeCompilerOptions()` deep-merges the user's `svelte.config.js`, so a
 * function-valued option can reach us. Passing one through would be silently
 * dropped by the binding — strip it here instead, on a shallow copy so the
 * caller's merged object is untouched.
 */
function adaptOptions(options: Record<string, unknown>): Record<string, unknown> {
  let adapted = options;
  for (const key of UNSUPPORTED_FUNCTION_OPTIONS) {
    if (typeof options[key] !== 'function') {
      continue;
    }
    if (adapted === options) {
      adapted = { ...options };
    }
    delete adapted[key];
    warnOnce(
      key,
      key === 'cssHash'
        ? "Falling back to Svelte's default `svelte-<hash>` scheme; pass the rsvelte-specific `cssHashOverride: '<hash>'` to force a fixed value."
        : 'All warnings are produced unfiltered.',
    );
  }
  return adapted;
}

/**
 * rsvelte backend for `Mochi.serve({ svelteCompiler: 'rsvelte' })`.
 *
 * Only `compile` / `compileModule` are ported — Mochi's island preprocessor
 * needs an upstream-shaped AST, which rsvelte's `parse()` (a JSON string) is
 * not, so parsing and preprocessing stay on the official compiler.
 */
export const svelteCompilerBackend: SvelteCompilerBackend = {
  name: 'rsvelte',
  version: RSVELTE_TARGET_VERSION,
  compile(source, options) {
    return rsCompile(source, adaptOptions(options as Record<string, unknown>)) as SvelteCompileOutput;
  },
  compileModule(source, options) {
    return rsCompileModule(source, adaptOptions(options as Record<string, unknown>)) as SvelteCompileOutput;
  },
};

export default svelteCompilerBackend;
