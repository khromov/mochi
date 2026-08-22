import type { Server } from 'bun';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath, relForDisplay } from '../utils';
import { logger } from '../utils/log';
import { applyFilter } from '../extensions';
import type { BunRouteValue } from '../types';

// `.well-known` is the IETF-standard discovery path (RFC 8615) used for
// `security.txt`, ACME HTTP-01 challenges, etc., so it is served even though
// its name starts with a dot.
const ALLOWED_DOT_DIRS = new Set(['.well-known']);

export function isExcludedDotPath(relative: string): boolean {
  const segments = relative.split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment || !segment.startsWith('.')) {
      continue;
    }
    if (i === 0 && ALLOWED_DOT_DIRS.has(segment)) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Map a public file's human-readable URL path (`/a b.txt`) to the route key it registers under. Bun's router matches the
 * percent-encoded request pathname the browser sends (`/a%20b.txt`), and `encodeURI` mirrors that encoding while
 * preserving `/` and path-legal chars. Every registration site MUST go through this, so the encoding can't drift
 * between the startup and dev-watcher-reload paths.
 */
export function publicRouteKey(urlPath: string): string {
  return encodeURI(urlPath);
}

/**
 * Scan a directory for static public assets, returning URL path → disk path with forward slashes on every platform.
 * Dotfiles and dot-directory contents are skipped apart from `.well-known/`, and a missing directory yields an empty map.
 */
export async function scanPublicDir(dir: string): Promise<Map<string, string>> {
  if (!existsSync(dir)) {
    return new Map();
  }
  // Pin the base to absolute while cwd is still valid, so `Bun.file()` can't re-resolve a relative disk path against a
  // later-changed or deleted cwd and turn every static file into a 404.
  const absDir = path.resolve(dir);
  const result = new Map<string, string>();
  const glob = new Bun.Glob('**/*');
  // Bun.Glob yields backslash separators on Windows, so normalizing first keeps the URL key at `/a/b` and lets
  // `isExcludedDotPath()` split on `/`; the disk value goes back through `path.join` for native separators.
  for await (const relative of glob.scan({ cwd: dir, dot: true })) {
    const rel = toPosixPath(relative);
    if (isExcludedDotPath(rel)) {
      continue;
    }
    result.set('/' + rel, path.join(absDir, rel));
  }
  return result;
}

/**
 * Resolve the public files to serve, shared by the startup and dev-watcher-reload paths so they can't drift. Every mode
 * scans the directory live, since the build copies nothing into the out-dir and `publicDir` is where these bytes live.
 * `development` survives as filter context for extensions to branch on.
 */
export async function resolvePublicFiles(opts: { publicDir: string; development: boolean }): Promise<Map<string, string>> {
  const source = await scanPublicDir(opts.publicDir);
  return applyFilter('publicDir:scan', source, { publicDir: opts.publicDir, development: opts.development });
}

/**
 * Wraps serving a public file (used by protection mode): either short-circuit with a blocked Response, or call `serve`
 * and decorate its result — a gate that read the clearance cookie must add `Vary: Cookie` to the served file too, or a
 * shared cache would replay a cleared visitor's copy to unverified ones.
 */
export type PublicRouteGuard = (req: Request, server: Server<undefined>, serve: () => Promise<Response>) => Promise<Response>;

/**
 * Register public files as Bun routes under their encoded keys, skipping any URL a user route already claims. Shared by
 * the startup and dev-watcher-reload paths so the encoding and conflict rules stay in lockstep — registering under a raw
 * key here is what made spaced filenames 404 before this was centralized.
 */
export function registerPublicRoutes(routes: Record<string, BunRouteValue>, files: Map<string, string>, guard?: PublicRouteGuard): void {
  for (const [urlPath, diskPath] of files) {
    const routeKey = publicRouteKey(urlPath);
    if (routeKey in routes) {
      logger.warn(`Public file "${relForDisplay(diskPath)}" skipped: URL "${urlPath}" is already registered as a route.`);
      continue;
    }
    // A guarded file becomes a handler route: static BunFile values can't run the check. The file re-checks existence so
    // a deletion 404s instead of surfacing Bun.file's lazy ENOENT as a 500.
    routes[routeKey] = guard
      ? (req: Request, server: Server<undefined>): Promise<Response> =>
          guard(req, server, async () => {
            const file = Bun.file(diskPath);
            if (!(await file.exists())) {
              return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
            return new Response(file);
          })
      : Bun.file(diskPath);
  }
}
