import type { SvelteCompileOutput, SvelteCompilerBackend } from 'mochi-framework';
import { nativeLoadError } from './nativeLoadError';

// Imported dynamically only so the failure is catchable — a static import would surface the
// binding loader's own (misleading) message with no chance to add the actionable cause.
const {
  compile: rsCompile,
  compileModule: rsCompileModule,
  VERSION: TARGET_SVELTE_VERSION,
} = await import('@rsvelte/vite-plugin-svelte-native').catch((err: unknown) => {
  throw nativeLoadError(err);
});

/**
 * The binding's own `VERSION` is the *Svelte* version it targets, not rsvelte's
 * — on its own it would keep the backend id stable across an rsvelte upgrade
 * that changes codegen, which is exactly what the compile-cache fingerprint has
 * to notice. Both numbers move independently, so both belong in the id.
 *
 * Resolved from this file's location rather than `process.cwd()`, which breaks
 * in monorepos and whenever the app is started from a non-root directory. An
 * unreadable manifest degrades the id, never the compile.
 */
async function bindingVersion(): Promise<string> {
  try {
    const pkgPath = Bun.resolveSync('@rsvelte/vite-plugin-svelte-native/package.json', import.meta.dir);
    const { version } = (await Bun.file(pkgPath).json()) as { version: string };
    return version;
  } catch {
    return 'unknown';
  }
}

const BACKEND_VERSION = `${await bindingVersion()}+svelte${TARGET_SVELTE_VERSION}`;

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
    // Mochi never surfaces compiler warnings, so a dropped `warningFilter` changes nothing worth a notice.
    if (key === 'cssHash') {
      warnOnce(key, "Falling back to Svelte's default `svelte-<hash>` scheme; pass the rsvelte-specific `cssHashOverride: '<hash>'` to force a fixed value.");
    }
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
  version: BACKEND_VERSION,
  compile(source, options) {
    return rsCompile(source, adaptOptions(options as Record<string, unknown>)) as SvelteCompileOutput;
  },
  compileModule(source, options) {
    return rsCompileModule(source, adaptOptions(options as Record<string, unknown>)) as SvelteCompileOutput;
  },
};

export default svelteCompilerBackend;
