/**
 * Runtime-served local image directories (`image: { localDirs: { media: './uploads' } }`)
 * — the runtime counterpart of build-time local image imports. Imports are baked
 * into the build; a local dir serves whatever is on disk right now, so app code
 * can `Bun.write` a new image and address it immediately at
 * `${assetPrefix}/files/<dir>/<path>`, with no registration step and URLs that
 * survive restarts.
 *
 * Both the route handler and `fetchImageSource` resolve paths through the single
 * `resolveLocalDirRef` below, so the security path is identical everywhere: the
 * dir name must be a configured root, the resolved path must stay inside it
 * (checked via `path.relative`, even though Bun's router normalizes `../` —
 * raw sockets may not), and only raster-image extensions are servable.
 */
import path from 'node:path';
import { getImageRuntime, getImageAssetPrefix } from './config';
import { IMAGE_FILE_FILTER, IMPORTED_IMAGE_FORMATS } from './types';
import type { ImportedImage, ImportedImageFormat } from './types';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

const RASTER_FORMATS: ReadonlySet<string> = new Set(IMPORTED_IMAGE_FORMATS);

export interface LocalDirFile {
  diskPath: string;
  contentType: string;
}

/** Resolve a decoded `<dir>/<rel/path.ext>` ref against the configured roots. */
function resolveLocalDirRef(ref: string, localDirs: Record<string, string>): LocalDirFile | undefined {
  if (ref.includes('\0')) {
    return undefined;
  }
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) {
    return undefined;
  }
  const dirName = ref.slice(0, slash);
  const rel = ref.slice(slash + 1);
  // Own-property check: callers may pass a plain object literal (tests, resolved
  // options predate the null-prototype map), and dir names come from URLs.
  const root = Object.hasOwn(localDirs, dirName) ? localDirs[dirName] : undefined;
  if (root === undefined || !IMAGE_FILE_FILTER.test(rel)) {
    return undefined;
  }
  const diskPath = path.resolve(root, rel);
  // The relative-path check catches every escape (`../`, absolute rel, and on
  // Windows backslash separators or drive-letter jumps) in one place.
  const escape = path.relative(root, diskPath);
  if (escape === '' || escape === '..' || escape.startsWith(`..${path.sep}`) || path.isAbsolute(escape)) {
    return undefined;
  }
  const ext = path.extname(rel).slice(1).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return undefined;
  }
  return { diskPath, contentType };
}

/**
 * Resolve a request pathname (`${assetPrefix}/files/<dir>/<rel…>`) to a disk
 * file, or `undefined` for anything that isn't a servable local-dir image.
 * Used by the `/files/*` route and by `fetchImageSource` (whose `src` arrives
 * decrypted from an authenticated token) to read transform sources from disk.
 */
export function resolveLocalDirFile(pathname: string, localDirs: Record<string, string> = getImageRuntime().options.localDirs): LocalDirFile | undefined {
  const prefix = `${getImageAssetPrefix()}/files/`;
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  let ref: string;
  try {
    ref = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return undefined;
  }
  return resolveLocalDirRef(ref, localDirs);
}

/**
 * Handler for the `${assetPrefix}/files/*` route. Unlike build-imported assets
 * (content-hashed, immutable), a local-dir file can be replaced in place under
 * the same URL — so production revalidates on every request (`must-revalidate`
 * + `Last-Modified`/304) instead of caching forever; dev sends no cache headers,
 * mirroring the asset route.
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

interface ProbedMeta {
  mtimeMs: number;
  size: number;
  image: ImportedImage;
}

// Pinned on globalThis (like the local-asset registry): compiled Svelte
// components get their own bundled copy of this module but must share one
// probe cache.
const META_KEY = '__mochi_local_dir_meta__';

function metaCache(): Map<string, ProbedMeta> {
  const g = globalThis as unknown as Record<string, unknown>;
  let map = g[META_KEY] as Map<string, ProbedMeta> | undefined;
  if (!map) {
    map = new Map();
    g[META_KEY] = map;
  }
  return map;
}

/**
 * Look up an image in a configured local dir by `'<dir>/<rel/path>'` ref and
 * return the same `{ src, width, height, format }` shape a build-time import
 * resolves to — usable with `<Image>`, `getImageUrl`, and plain `<img>`.
 * Server-only. Probes are memoized per disk path and revalidated by mtime+size,
 * so a replaced file re-probes while repeated renders stay cheap.
 */
export async function localImage(ref: string): Promise<ImportedImage> {
  const normalized = ref.replace(/^\/+/, '');
  const localDirs = getImageRuntime().options.localDirs;
  const info = resolveLocalDirRef(normalized, localDirs);
  if (!info) {
    const dirs = Object.keys(localDirs);
    throw new Error(
      `localImage("${ref}"): not a resolvable local-dir image. Expected "<dir>/<relative path>" where <dir> is one of ` +
        `image.localDirs (${dirs.length ? dirs.map((d) => `"${d}"`).join(', ') : 'none configured'}) and the path stays ` +
        `inside its root with a raster-image extension (png, jpg, jpeg, webp, avif, gif).`,
    );
  }
  const file = Bun.file(info.diskPath);
  if (!(await file.exists())) {
    throw new Error(`localImage("${ref}"): file not found at ${info.diskPath}`);
  }
  const src = `${getImageAssetPrefix()}/files/${normalized.split('/').map(encodeURIComponent).join('/')}`;
  const mtimeMs = file.lastModified;
  const size = file.size;
  const cached = metaCache().get(info.diskPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return { ...cached.image, src };
  }
  const bytes = await file.bytes();
  let meta: Bun.Image.Metadata;
  try {
    meta = await new Bun.Image(bytes).metadata();
  } catch {
    throw new Error(`localImage("${ref}"): the file could not be decoded as an image. ` + `Only raster images (png, jpg, jpeg, webp, avif, gif) are supported.`);
  }
  if (!RASTER_FORMATS.has(meta.format)) {
    throw new Error(`localImage("${ref}"): unsupported format "${meta.format}". Supported: png, jpg, jpeg, webp, avif, gif.`);
  }
  const image: ImportedImage = { src, width: meta.width, height: meta.height, format: meta.format as ImportedImageFormat };
  metaCache().set(info.diskPath, { mtimeMs, size, image });
  return image;
}
