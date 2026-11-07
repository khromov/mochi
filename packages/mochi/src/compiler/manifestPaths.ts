import path from 'node:path';
import { toPosixPath } from '../utils';
import { logger } from '../utils/log';

// Climbs one level out of `src/compiler/`, the same convention as `SRC_DIR` in `ComponentRegistry.ts`.
const SRC_DIR = path.resolve(path.dirname(Bun.fileURLToPath(import.meta.url)), '..');

/**
 * Marks a manifest path as framework-owned, in the spirit of SvelteKit's `$lib`. `SRC_DIR` lands somewhere different in
 * a workspace checkout, a plain `node_modules/` install, and Bun's versioned store, so encoding framework components
 * relative to the project would bake the package-manager layout and framework version into the manifest.
 */
export const FRAMEWORK_PREFIX = '$mochi/';

/**
 * Encode a build-time source path for the manifest. These paths are lookup keys, never opened at runtime, but must
 * survive the build output being copied to another machine: absolute ones leak the builder's filesystem layout and make
 * two machines building the same commit emit different manifests.
 *
 * A `..` result is fine here, unlike for artifact paths (`relToOutDir` in `ComponentRegistry.toManifest`) — sources
 * legitimately live outside the project root, in a monorepo sibling or a hoisted `node_modules`, and a deploy preserves
 * the relative structure between them.
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
