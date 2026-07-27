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
 * Loads a Svelte config file. `configPath` is resolved against `process.cwd()`
 * if relative, used as-is if absolute, and defaults to `./svelte.config.js`.
 * Returns `{}` if the file is missing. Supports both ESM (`export default`)
 * and CJS (`module.exports`).
 *
 * Pass `{ reload: true }` for the dev-watcher path so edits are re-evaluated:
 * Bun's query-string cache-busting is unreliable on some platforms (Windows),
 * so `freshImportBundled` re-imports a uniquely-named bundle instead. Bundling
 * (rather than copying) keeps the config's relative imports working from the
 * `tempDir` copy. Startup/build loads happen once, so they import the file
 * directly and leave nothing behind.
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

/**
 * Applied last, after both the user's config and the per-call-site overrides.
 * `mochi-framework`'s own components (`<Image>`) use top-level `await`, so an app
 * that turned this off would fail to compile the framework's own source.
 */
export const FRAMEWORK_FORCED_COMPILER_OPTIONS: CompileOptions = {
  experimental: { async: true },
};

/**
 * `arrayMerge` strategy for `deepmerge`: replace the destination array with the
 * source array rather than concatenating. Keeps last-write-wins semantics for
 * arrays at every nesting depth, mirroring how plain values behave.
 */
const overwriteMerge = (_destinationArray: unknown[], sourceArray: unknown[]): unknown[] => sourceArray;

/**
 * Four-layer merge for Svelte `compilerOptions`:
 *   1. framework defaults (e.g. `discloseVersion: false`)
 *   2. user options from `svelte.config.js`
 *   3. framework-owned overrides for the current call site (e.g. `generate`, `filename`)
 *   4. framework-forced options that nothing may override (`experimental.async`)
 *
 * Later layers win, and nested plain objects are deep-merged rather than replaced.
 */
export function mergeCompilerOptions(user: CompileOptions | undefined, forced: CompileOptions): CompileOptions {
  return deepmerge.all<CompileOptions>([FRAMEWORK_COMPILER_DEFAULTS, user ?? {}, forced, FRAMEWORK_FORCED_COMPILER_OPTIONS], {
    arrayMerge: overwriteMerge,
  });
}
