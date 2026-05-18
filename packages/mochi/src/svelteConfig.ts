import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import deepmerge from 'deepmerge';
import type { CompileOptions } from 'svelte/compiler';
import { logger } from './log';

export interface MochiSvelteConfig {
  compilerOptions?: CompileOptions;
}

/**
 * Loads a Svelte config file. `configPath` is resolved against `process.cwd()`
 * if relative, used as-is if absolute, and defaults to `./svelte.config.js`.
 * Returns `{}` if the file is missing. Supports both ESM (`export default`)
 * and CJS (`module.exports`).
 */
export async function loadSvelteConfig(configPath?: string): Promise<MochiSvelteConfig> {
  const resolved = path.resolve(configPath ?? 'svelte.config.js');
  if (!existsSync(resolved)) {
    logger.warn(`No Svelte config found at ${resolved} — using framework defaults.`);
    return {};
  }
  // Cache-bust the dynamic import so dev-mode reloads see fresh content. Without
  // pathToFileURL, raw absolute paths can't carry a query string reliably across
  // platforms.
  const url = `${pathToFileURL(resolved).href}?t=${Date.now()}`;
  const mod = await import(url);
  return (mod.default ?? mod) as MochiSvelteConfig;
}

/** Framework-level defaults applied when the user does not specify them. */
export const FRAMEWORK_COMPILER_DEFAULTS: CompileOptions = {
  experimental: { async: true },
  discloseVersion: false,
};

/**
 * `arrayMerge` strategy for `deepmerge`: replace the destination array with the
 * source array rather than concatenating. Keeps last-write-wins semantics for
 * arrays at every nesting depth, mirroring how plain values behave.
 */
const overwriteMerge = (_destinationArray: unknown[], sourceArray: unknown[]): unknown[] => sourceArray;

/**
 * Three-layer merge for Svelte `compilerOptions`:
 *   1. framework defaults (e.g. `experimental.async: true`)
 *   2. user options from `svelte.config.js`
 *   3. framework-owned overrides for the current call site (e.g. `generate`, `filename`)
 *
 * Later layers win, and nested plain objects are deep-merged rather than replaced.
 */
export function mergeCompilerOptions(user: CompileOptions | undefined, forced: CompileOptions): CompileOptions {
  return deepmerge.all<CompileOptions>([FRAMEWORK_COMPILER_DEFAULTS, user ?? {}, forced], {
    arrayMerge: overwriteMerge,
  });
}
