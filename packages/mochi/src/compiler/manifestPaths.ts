import path from 'node:path';
import { toPosixPath } from '../utils';
import { logger } from '../utils/log';

/**
 * Framework source root (`src/`). This file lives in `src/compiler/`, so climb
 * one level — same convention as `SRC_DIR` in `ComponentRegistry.ts`.
 */
const SRC_DIR = path.resolve(path.dirname(Bun.fileURLToPath(import.meta.url)), '..');

/**
 * Marks a manifest path as framework-owned, in the spirit of SvelteKit's `$lib`.
 * `SRC_DIR` sits somewhere different in a workspace checkout, a plain
 * `node_modules/` install, and Bun's versioned store, so encoding the
 * framework's own components relative to the *project* would bake the
 * package-manager layout and the framework version into the manifest — and
 * break the moment either changes.
 */
export const FRAMEWORK_PREFIX = '$mochi/';

/**
 * Encode a build-time source path for the manifest.
 *
 * Source paths in a manifest are lookup keys, never opened at runtime, but they
 * must still survive the build output being copied to another machine: keeping
 * them absolute leaks the builder's filesystem layout and makes two machines
 * building the same commit emit different manifests.
 *
 * Unlike artifact paths (see `relToOutDir` in `ComponentRegistry.toManifest`), a
 * `..` result is normal and fine here — sources legitimately live outside the
 * project root (a monorepo sibling, a hoisted `node_modules`) and the relative
 * structure between them is what a deploy preserves.
 */
export function encodeSourcePath(p: string, projectRoot: string = process.cwd(), srcDir: string = SRC_DIR): string {
  const abs = path.resolve(p);
  if (abs === srcDir || abs.startsWith(srcDir + path.sep)) {
    return FRAMEWORK_PREFIX + toPosixPath(path.relative(srcDir, abs));
  }
  const rel = path.relative(path.resolve(projectRoot), abs);
  // On Windows a different-drive target has no relative form, so path.relative()
  // hands back an absolute path. That's the one case we can't make portable.
  if (path.isAbsolute(rel)) {
    logger.warn(`Source path ${toPosixPath(abs)} is on a different drive than the project root — baking an absolute path. This build will not relocate.`);
    return toPosixPath(abs);
  }
  return toPosixPath(rel);
}

/** Inverse of `encodeSourcePath`, resolving against the *serving* process's roots. */
export function decodeSourcePath(p: string, projectRoot: string = process.cwd(), srcDir: string = SRC_DIR): string {
  if (p.startsWith(FRAMEWORK_PREFIX)) {
    return path.resolve(srcDir, p.slice(FRAMEWORK_PREFIX.length));
  }
  return path.resolve(projectRoot, p);
}
