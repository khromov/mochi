import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import deepmerge from 'deepmerge';
import type { CompileOptions } from 'svelte/compiler';
import { logger } from '../utils/log';
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
  return (mod.default ?? mod) as MochiSvelteConfig;
}

/** Framework-level defaults applied when the user does not specify them. */
export const FRAMEWORK_COMPILER_DEFAULTS: CompileOptions = {
  experimental: { async: true },
  discloseVersion: false,
};

// Replacing the destination array rather than concatenating keeps last-write-wins semantics at every nesting depth,
// mirroring how plain values behave.
const overwriteMerge = (_destinationArray: unknown[], sourceArray: unknown[]): unknown[] => sourceArray;

/**
 * Three-layer merge for Svelte `compilerOptions`, later layers winning and nested plain objects deep-merged:
 *   1. framework defaults (e.g. `experimental.async: true`)
 *   2. user options from `svelte.config.js`
 *   3. framework-owned overrides for the call site (e.g. `generate`, `filename`)
 */
export function mergeCompilerOptions(user: CompileOptions | undefined, forced: CompileOptions): CompileOptions {
  return deepmerge.all<CompileOptions>([FRAMEWORK_COMPILER_DEFAULTS, user ?? {}, forced], {
    arrayMerge: overwriteMerge,
  });
}
