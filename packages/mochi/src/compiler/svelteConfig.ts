import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import deepmerge from 'deepmerge';
import type { CompileOptions } from 'svelte/compiler';
import { logger } from '../utils/log';
import { toPosixPath } from '../utils';
import { freshImportBundled } from './freshImport';

export interface MochiSvelteConfig {
  compilerOptions?: CompileOptions;
}

/**
 * Loads a Svelte config file, resolving a relative `configPath` against `process.cwd()` and defaulting to
 * `./svelte.config.js`. A missing file yields `{}`, and both ESM and CJS shapes work.
 *
 * Pass `{ reload: true }` on the dev-watcher path so edits re-evaluate: Bun's query-string cache-busting is unreliable
 * on Windows, so `freshImportBundled` re-imports a uniquely-named bundle, and bundling rather than copying keeps the
 * config's relative imports working from the `tempDir` copy. Startup and build loads happen once, importing directly.
 */
export async function loadSvelteConfig(configPath?: string, opts: { reload?: boolean; tempDir?: string } = {}): Promise<MochiSvelteConfig> {
  const resolved = path.resolve(configPath ?? 'svelte.config.js');
  if (!existsSync(resolved)) {
    logger.warn(`No Svelte config found at ${resolved} — using framework defaults.`);
    return {};
  }
  const mod = opts.reload ? await freshImportBundled(resolved, opts.tempDir ?? path.join(path.dirname(resolved), '.mochi')) : await import(pathToFileURL(resolved).href);
  const config = (mod.default ?? mod) as MochiSvelteConfig;
  if (config.compilerOptions?.experimental?.async === false) {
    logger.warn(`${toPosixPath(resolved)} sets compilerOptions.experimental.async to false — ignoring, Mochi always compiles with it enabled.`);
  }
  return config;
}

/** Framework-level defaults applied when the user does not specify them. */
export const FRAMEWORK_COMPILER_DEFAULTS: CompileOptions = {
  discloseVersion: false,
};

// Applied last, after both the user's config and the per-call-site overrides. Mochi's own components (`<Image>`) use
// top-level `await`, so an app that turned this off would fail to compile the framework's own source.
export const FRAMEWORK_FORCED_COMPILER_OPTIONS: CompileOptions = {
  experimental: { async: true },
};

// Replacing the destination array rather than concatenating keeps last-write-wins semantics at every nesting depth,
// mirroring how plain values behave.
const overwriteMerge = (_destinationArray: unknown[], sourceArray: unknown[]): unknown[] => sourceArray;

/**
 * Four-layer merge for Svelte `compilerOptions`, later layers winning and nested plain objects deep-merged:
 *   1. framework defaults (e.g. `discloseVersion: false`)
 *   2. user options from `svelte.config.js`
 *   3. framework-owned overrides for the call site (e.g. `generate`, `filename`)
 *   4. framework-forced options that nothing may override (`experimental.async`)
 */
export function mergeCompilerOptions(user: CompileOptions | undefined, forced: CompileOptions): CompileOptions {
  return deepmerge.all<CompileOptions>([FRAMEWORK_COMPILER_DEFAULTS, user ?? {}, forced, FRAMEWORK_FORCED_COMPILER_OPTIONS], {
    arrayMerge: overwriteMerge,
  });
}
