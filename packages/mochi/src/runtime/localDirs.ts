/**
 * Runtime-served local directories (`Mochi.serve({ localDirs: { media: './uploads' } })`).
 * A local dir serves whatever is on disk right now, so app code can `Bun.write`
 * a new file and address it immediately at `${assetPrefix}/files/<dir>/<path>`,
 * with no registration step and URLs that survive restarts. Any file type is
 * servable; the image layer (`localImage`, transforms) narrows to raster images
 * on top of this module.
 *
 * The route handler, `localFile`/`localFileBytes`, and the image layer all
 * resolve paths through the single `resolveLocalDirRef` below, so the security
 * path is identical everywhere: the dir name must be a configured root, the
 * resolved path must stay inside it (checked via `path.relative`, even though
 * Bun's router normalizes `../` — raw sockets may not), and dotfile paths are
 * refused unless the dir opts in with `includeDotfiles: true` (same policy as
 * `Mochi.file` / the public dir, `.well-known` exempt).
 */
import path from 'node:path';
import { getAssetPrefix, getMochiConfig } from '../mochiConfig';
import { isExcludedDotPath } from './publicDir';
import { toPosixPath } from '../utils';
import type { BunFile } from 'bun';
import type { MochiLocalDirs } from '../types';

export interface ResolvedLocalDir {
  root: string;
  includeDotfiles: boolean;
}

export type ResolvedLocalDirs = Record<string, ResolvedLocalDir>;

export function resolveLocalDirs(raw: MochiLocalDirs | undefined): ResolvedLocalDirs {
  // Null-prototype: dir names come from URLs at request time, so a plain object
  // would resolve names like "constructor" through the prototype chain.
  const out: ResolvedLocalDirs = Object.create(null);
  for (const [name, entry] of Object.entries(raw ?? {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new Error(`localDirs name "${name}" is invalid: names appear in URLs and may only contain letters, digits, "_" and "-"`);
    }
    const root = typeof entry === 'string' ? entry : entry.root;
    if (typeof root !== 'string' || root.length === 0) {
      throw new Error(`localDirs "${name}": root must be a non-empty path`);
    }
    out[name] = { root: path.resolve(root), includeDotfiles: typeof entry === 'object' && (entry.includeDotfiles ?? false) };
  }
  return out;
}

// Pinned on globalThis (like __mochi_config__): compiled SSR components get
// their own bundled copy of this module but must share one resolved map.
const DIRS_KEY = '__mochi_local_dirs__';

export function getLocalDirs(): ResolvedLocalDirs {
  const g = globalThis as unknown as Record<string, unknown>;
  let dirs = g[DIRS_KEY] as ResolvedLocalDirs | undefined;
  if (!dirs) {
    dirs = resolveLocalDirs(getMochiConfig().options.localDirs);
    g[DIRS_KEY] = dirs;
  }
  return dirs;
}

const NO_DIRS: ResolvedLocalDirs = Object.create(null);

/**
 * Like `getLocalDirs`, but before `Mochi.serve()` has initialized the config
 * there are simply no local dirs — for callers (e.g. the image fetch path)
 * that must not fail on an uninitialized server.
 */
export function peekLocalDirs(): ResolvedLocalDirs {
  const g = globalThis as unknown as Record<string, unknown>;
  return g['__mochi_config__'] ? getLocalDirs() : NO_DIRS;
}

export interface LocalDirFile {
  diskPath: string;
  contentType: string;
}

/** Resolve a decoded `<dir>/<rel/path>` ref against the configured roots. */
export function resolveLocalDirRef(ref: string, dirs: ResolvedLocalDirs = getLocalDirs()): LocalDirFile | undefined {
  if (ref.includes('\0')) {
    return undefined;
  }
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) {
    return undefined;
  }
  const dirName = ref.slice(0, slash);
  const rel = ref.slice(slash + 1);
  // Own-property check: callers may pass plain object literals (tests), and dir
  // names come from URLs.
  const dir = Object.hasOwn(dirs, dirName) ? dirs[dirName] : undefined;
  if (dir === undefined) {
    return undefined;
  }
  if (!dir.includeDotfiles && isExcludedDotPath(toPosixPath(rel))) {
    return undefined;
  }
  const diskPath = path.resolve(dir.root, rel);
  // The relative-path check catches every escape (`../`, absolute rel, and on
  // Windows backslash separators or drive-letter jumps) in one place.
  const escape = path.relative(dir.root, diskPath);
  if (escape === '' || escape === '..' || escape.startsWith(`..${path.sep}`) || path.isAbsolute(escape)) {
    return undefined;
  }
  // Bun's extension→type table is case-sensitive; probe with a lowercased
  // extension so `.JPG` serves image/jpeg, not application/octet-stream.
  const contentType = Bun.file(`t${path.extname(diskPath).toLowerCase()}`).type || 'application/octet-stream';
  return { diskPath, contentType };
}

/**
 * Resolve a request pathname (`${assetPrefix}/files/<dir>/<rel…>`) to a disk
 * file, or `undefined` for anything that isn't a servable local-dir file.
 * Used by the `/files/*` route and by the image layer (whose transform `src`
 * arrives decrypted from an authenticated token).
 */
export function resolveLocalDirFile(pathname: string, dirs: ResolvedLocalDirs = getLocalDirs()): LocalDirFile | undefined {
  const prefix = `${getAssetPrefix()}/files/`;
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  let ref: string;
  try {
    ref = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return undefined;
  }
  return resolveLocalDirRef(ref, dirs);
}

/**
 * Handler for the `${assetPrefix}/files/*` route. Unlike build-imported assets
 * (content-hashed, immutable), a local-dir file can be replaced in place under
 * the same URL — so production revalidates on every request (`must-revalidate`
 * + `Last-Modified`/304) instead of caching forever; dev sends no cache
 * headers, mirroring the asset route. The body stays a `BunFile` so Bun's
 * native `Range` handling (206/416, `Accept-Ranges: bytes`) applies.
 */
export function createLocalFilesHandler(development: boolean): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const info = resolveLocalDirFile(new URL(req.url).pathname);
    const file = info && Bun.file(info.diskPath);
    if (!file || !(await file.exists())) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const headers: Record<string, string> = {
      'Content-Type': info.contentType,
      'X-Content-Type-Options': 'nosniff',
    };
    if (!development) {
      headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
      // HTTP dates have second precision — floor before comparing, or a file
      // written milliseconds after the header was minted would never 304.
      const lastModified = Math.floor(file.lastModified / 1000) * 1000;
      headers['Last-Modified'] = new Date(lastModified).toUTCString();
      const ifModifiedSince = Date.parse(req.headers.get('If-Modified-Since') ?? '');
      if (!Number.isNaN(ifModifiedSince) && lastModified <= ifModifiedSince) {
        return new Response(null, { status: 304, headers });
      }
    }
    return new Response(file, { headers });
  };
}

/** What `localFile()` resolves to. Plain data — safe to pass as a page prop. */
export interface LocalFile {
  url: string;
  size: number;
  contentType: string;
  lastModified: number;
}

function refUrl(normalized: string): string {
  return `${getAssetPrefix()}/files/${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

async function resolveOrThrow(api: string, ref: string): Promise<{ file: BunFile; info: LocalDirFile; normalized: string }> {
  const normalized = ref.replace(/^\/+/, '');
  const info = resolveLocalDirRef(normalized);
  if (!info) {
    const dirs = Object.keys(getLocalDirs());
    throw new Error(
      `${api}("${ref}"): not a resolvable local-dir file. Expected "<dir>/<relative path>" where <dir> is one of ` +
        `localDirs (${dirs.length ? dirs.map((d) => `"${d}"`).join(', ') : 'none configured'}) and the path stays inside ` +
        `its root. Dotfile paths are refused unless that dir sets includeDotfiles: true.`,
    );
  }
  const file = Bun.file(info.diskPath);
  if (!(await file.exists())) {
    throw new Error(`${api}("${ref}"): file not found at ${info.diskPath}`);
  }
  return { file, info, normalized };
}

/**
 * Look up a file in a configured local dir by `'<dir>/<rel/path>'` ref and
 * return its served URL + metadata. Server-only; throws with a helpful message
 * on unknown dirs, escapes, refused dotfiles, and missing files. For raster
 * images prefer `localImage`, which also probes intrinsic dimensions.
 */
export async function localFile(ref: string): Promise<LocalFile> {
  const { file, info, normalized } = await resolveOrThrow('localFile', ref);
  return { url: refUrl(normalized), size: file.size, contentType: info.contentType, lastModified: file.lastModified };
}

/** Read a local-dir file's bytes through the same root-confined, dotfile-guarded resolution as `localFile`. */
export async function localFileBytes(ref: string): Promise<Uint8Array> {
  const { file } = await resolveOrThrow('localFileBytes', ref);
  return file.bytes();
}
