import { existsSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from './utils';

// `.well-known` is the IETF-standard discovery path (RFC 8615) used for
// `security.txt`, ACME HTTP-01 challenges, etc., so it is served even though
// its name starts with a dot.
const ALLOWED_DOT_DIRS = new Set(['.well-known']);

function isExcludedDotPath(relative: string): boolean {
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
 * Scan a directory for static public assets. Returns a map of
 * URL path (e.g. `/img/logo.png`) → disk path, using forward slashes on all
 * platforms. Dotfiles and files inside dot-directories are skipped, except
 * for files under `.well-known/` which are served. Returns an empty map
 * if the directory does not exist.
 */
export async function scanPublicDir(dir: string): Promise<Map<string, string>> {
  if (!existsSync(dir)) {
    return new Map();
  }
  const result = new Map<string, string>();
  const glob = new Bun.Glob('**/*');
  // Bun.Glob yields backslash separators on Windows, so normalize to forward
  // slashes before use: the URL key must be `/a/b` (not `/a\b`) and
  // isExcludedDotPath() splits on `/`. The disk value goes back through
  // path.join to pick up native separators.
  for await (const relative of glob.scan({ cwd: dir, dot: true })) {
    const rel = toPosixPath(relative);
    if (isExcludedDotPath(rel)) {
      continue;
    }
    result.set('/' + rel, path.join(dir, rel));
  }
  return result;
}
