import path from 'node:path';
import type { BunRouteValue } from '../types';

/** A prefix → directory mount, as declared in `Mochi.serve({ staticDirs })`. */
export type MochiStaticDirs = Record<string, string>;

/**
 * Validate the mounts and normalize each prefix. Throws on anything Bun's directory routes cannot express, so a bad
 * mount rejects before the socket binds rather than 404ing at runtime.
 */
export function resolveStaticDirs(staticDirs: MochiStaticDirs, assetPrefix: string): { pattern: string; dir: string }[] {
  const seen = new Set<string>();
  return Object.entries(staticDirs).map(([rawPrefix, dir]) => {
    if (!rawPrefix.startsWith('/')) {
      throw new Error(`Mochi.serve({ staticDirs }): prefix "${rawPrefix}" must start with "/".`);
    }
    const prefix = rawPrefix.endsWith('/') ? rawPrefix.replace(/\/+$/, '') : rawPrefix;
    if (prefix === '') {
      // A root mount would have to register the global catch-all `/*`, which answers every otherwise-unmatched
      // request with Bun's own 404 — the framework's error page, `fetch` fallback and asset routes would stop
      // running. `publicDir` is the supported way to serve files at the site root.
      throw new Error(`Mochi.serve({ staticDirs }): "/" cannot be mounted — it would shadow every unmatched route. Use publicDir to serve files at the site root.`);
    }
    if (prefix.includes('*') || prefix.includes(':')) {
      throw new Error(`Mochi.serve({ staticDirs }): prefix "${rawPrefix}" must be a literal path — no ":" params or "*" wildcards.`);
    }
    if (prefix === assetPrefix || prefix.startsWith(`${assetPrefix}/`)) {
      throw new Error(`Mochi.serve({ staticDirs }): prefix "${rawPrefix}" is inside the framework asset prefix "${assetPrefix}". Mount it somewhere else.`);
    }
    if (seen.has(prefix)) {
      throw new Error(`Mochi.serve({ staticDirs }): "${prefix}" is mounted twice.`);
    }
    seen.add(prefix);
    if (typeof dir !== 'string' || dir === '') {
      throw new Error(`Mochi.serve({ staticDirs }): "${rawPrefix}" needs a directory path.`);
    }
    // Pinned absolute while cwd is still valid, matching publicDir — a later chdir must not re-resolve the mount.
    return { pattern: `${prefix}/*`, dir: path.resolve(dir) };
  });
}

/**
 * Register the mounts as Bun directory routes. Deliberately called after the trailing-slash mirroring pass: a `/*`
 * pattern must never be mirrored to `/*\/`, which is not a valid route.
 */
export function registerStaticDirRoutes(bunRoutes: Record<string, BunRouteValue>, mounts: { pattern: string; dir: string }[]): void {
  for (const { pattern, dir } of mounts) {
    if (pattern in bunRoutes) {
      throw new Error(`Mochi.serve({ staticDirs }): "${pattern}" is already registered as a route. Mount the directory somewhere else, or drop the conflicting route.`);
    }
    // Bun's `{ dir }` route value predates the BunRouteValue union here, hence the cast.
    bunRoutes[pattern] = { dir } as unknown as BunRouteValue;
  }
}
