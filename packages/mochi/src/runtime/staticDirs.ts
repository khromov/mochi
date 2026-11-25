import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { BunRouteValue } from '../types';
import { relForDisplay } from '../utils';
import { isExcludedDotPath, publicRouteKey } from './publicDir';

/** A prefix → directory mount, as declared in `Mochi.serve({ staticDirs })`. */
export type MochiStaticDirs = Record<string, string>;

/** Validate and normalize each mount, throwing before the socket binds on anything Bun's directory routes cannot express. */
export function resolveStaticDirs(staticDirs: MochiStaticDirs, assetPrefix: string): { pattern: string; dir: string; blocked: string[] }[] {
  const seen = new Set<string>();
  return Object.entries(staticDirs).map(([rawPrefix, dir]) => {
    if (!rawPrefix.startsWith('/')) {
      throw new Error(`Mochi.serve({ staticDirs }): prefix "${rawPrefix}" must start with "/".`);
    }
    const prefix = rawPrefix.endsWith('/') ? rawPrefix.replace(/\/+$/, '') : rawPrefix;
    if (prefix === '') {
      // A root mount would register the global catch-all `/*`, which answers every unmatched request with Bun's own
      // 404 — shadowing the framework's error page, `fetch` fallback and asset routes.
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
    const resolved = path.resolve(dir);
    // Bun's directory route resolves the path per request, so a typo would otherwise surface as a bare per-request
    // ENOENT naming neither the prefix nor the option.
    const stats = statSync(resolved, { throwIfNoEntry: false });
    if (!stats) {
      throw new Error(`Mochi.serve({ staticDirs }): "${rawPrefix}" points at "${dir}", which does not exist (looked in ${relForDisplay(resolved)}).`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Mochi.serve({ staticDirs }): "${rawPrefix}" points at "${dir}", which is a file, not a directory.`);
    }
    // Bun matches routes on the raw request path but the directory route decodes it, so an ancestor with more than one URL
    // spelling becomes a param, and the dot name itself is blocked percent-encoded in either hex case.
    const blocked = findDotEntries(resolved).flatMap((rel) => {
      const segments = rel.split('/');
      const name = segments.pop()!;
      const parents = segments.map((segment, i) => (/^[\w.~-]+$/.test(segment) ? segment : `:p${i}`));
      const names = [publicRouteKey(name), encodeURIComponent(name)].flatMap((n) => [n, n.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())]);
      return [...new Set(names)].map((n) => [prefix, ...parents, n].join('/'));
    });
    return { pattern: `${prefix}/*`, dir: resolved, blocked };
  });
}

/** POSIX paths of the entries publicDir's dot policy refuses; a refused directory is not descended into, so a `.git` costs one entry. */
function findDotEntries(dir: string, rel = ''): string[] {
  let entries;
  try {
    entries = readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    // An unreadable subdirectory (a mounted volume's `lost+found`) must not fail the boot.
    return [];
  }
  return entries.flatMap((entry) => {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (isExcludedDotPath(child)) {
      return [child];
    }
    return entry.isDirectory() ? findDotEntries(dir, child) : [];
  });
}

/** Register the mounts as Bun directory routes, after the trailing-slash mirroring pass — a `/*` pattern must never be mirrored to `/*\/`, which is not a valid route. */
export function registerStaticDirRoutes(bunRoutes: Record<string, BunRouteValue>, mounts: { pattern: string; dir: string; blocked: string[] }[]): void {
  for (const { pattern, dir, blocked } of mounts) {
    if (pattern in bunRoutes) {
      throw new Error(`Mochi.serve({ staticDirs }): "${pattern}" is already registered as a route. Mount the directory somewhere else, or drop the conflicting route.`);
    }
    // Bun's `{ dir }` route value predates the BunRouteValue union here, hence the cast.
    bunRoutes[pattern] = { dir } as unknown as BunRouteValue;
    // Bun's directory route has no dotfile notion, so the dot entries present at boot are shadowed by more specific 404 routes.
    for (const route of blocked) {
      for (const key of [route, `${route}/*`]) {
        bunRoutes[key] ??= new Response(null, { status: 404 });
      }
    }
  }
}
