import path from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import type { BunRouteValue } from '../types';
import { relForDisplay, toPosixPath } from '../utils';
import { isExcludedDotPath } from './publicDir';

/** A prefix → directory mount, as declared in `Mochi.serve({ staticDirs })`. */
export type MochiStaticDirs = Record<string, string>;

/** Validate and normalize each mount, throwing before the socket binds on anything Bun's directory routes cannot express. */
export function resolveStaticDirs(staticDirs: MochiStaticDirs, assetPrefix: string): { pattern: string; dir: string }[] {
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
    // The mount resolves paths per request, so a typo would otherwise surface as a bare per-request 404 naming neither
    // the prefix nor the option.
    const stats = statSync(resolved, { throwIfNoEntry: false });
    if (!stats) {
      throw new Error(`Mochi.serve({ staticDirs }): "${rawPrefix}" points at "${dir}", which does not exist (looked in ${relForDisplay(resolved)}).`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Mochi.serve({ staticDirs }): "${rawPrefix}" points at "${dir}", which is a file, not a directory.`);
    }
    // Real, so a request's resolved file compares against it even when the mount itself sits behind a symlink.
    return { pattern: `${prefix}/*`, dir: realpathSync(resolved) };
  });
}

/** Register each mount as one wildcard route, after the trailing-slash mirroring pass — a `/*` pattern must never be mirrored to `/*\/`, which is not a valid route. */
export function registerStaticDirRoutes(bunRoutes: Record<string, BunRouteValue>, mounts: { pattern: string; dir: string }[]): void {
  for (const { pattern, dir } of mounts) {
    if (pattern in bunRoutes) {
      throw new Error(`Mochi.serve({ staticDirs }): "${pattern}" is already registered as a route. Mount the directory somewhere else, or drop the conflicting route.`);
    }
    // A handler rather than Bun's `{ dir }` route, which serves dot entries and has no hook to refuse them.
    bunRoutes[pattern] = serveStaticDir(pattern.slice(0, -1), dir);
  }
}

const notFound = (): Response => new Response(null, { status: 404 });

function serveStaticDir(base: string, root: string): (req: Request) => Response {
  return (req) => {
    const { pathname, search } = new URL(req.url);
    let rel: string;
    try {
      rel = decodeURIComponent(pathname.slice(base.length));
    } catch {
      return notFound();
    }
    // Bun resolves `..` in `req.url` after routing, which can lift the path out of the prefix the route matched.
    if (!pathname.startsWith(base) || isExcludedDotPath(rel)) {
      return notFound();
    }
    let file: string;
    try {
      // Sync on purpose: the promise forms hop through the thread pool, which cost ~40% of small-file throughput.
      file = realpathSync(path.join(root, pathname.endsWith('/') ? `${rel}index.html` : rel));
    } catch {
      return notFound();
    }
    // Checked again once symlinks and Windows `\` separators have resolved, so neither reaches a dot entry or leaves the mount.
    const inside = path.relative(root, file);
    if (path.isAbsolute(inside) || isExcludedDotPath(toPosixPath(inside))) {
      return notFound();
    }
    const stats = statSync(file, { throwIfNoEntry: false });
    if (!stats) {
      return notFound();
    }
    if (stats.isDirectory()) {
      return pathname.endsWith('/') ? notFound() : new Response(null, { status: 301, headers: { Location: `${pathname}/${search}` } });
    }
    const seconds = Math.floor(stats.mtimeMs / 1000);
    const etag = `W/"${stats.size.toString(16)}-${seconds.toString(16)}"`;
    const headers = { ETag: etag, 'Last-Modified': stats.mtime.toUTCString() };
    const ifNoneMatch = req.headers.get('if-none-match');
    const ifModifiedSince = req.headers.get('if-modified-since');
    const fresh = ifNoneMatch
      ? ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.slice(2))
      : ifModifiedSince !== null && Date.parse(ifModifiedSince) >= seconds * 1000;
    // Bun answers `Range` and `HEAD` for a file body on its own, but leaves conditional requests to the handler.
    return fresh ? new Response(null, { status: 304, headers }) : new Response(Bun.file(file), { headers });
  };
}
