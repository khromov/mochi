/**
 * The image view of runtime local dirs (`Mochi.serve({ localDirs })`): the
 * general layer (`runtime/localDirs.ts`) serves any file type; this module
 * narrows resolution to raster images for `localImage` and the transform
 * pipeline, keying content types off `IMAGE_MIME` so transform sources carry
 * the same types as build-time imports.
 */
import path from 'node:path';
import { getAssetPrefix } from '../mochiConfig';
import { getLocalDirs, resolveLocalDirFile, resolveLocalDirRef } from '../runtime/localDirs';
import type { LocalDirFile } from '../runtime/localDirs';
import { IMAGE_FORMAT_BY_EXT, IMAGE_MIME, IMPORTED_IMAGE_FORMATS } from './types';
import type { ImportedImage, ImportedImageFormat } from './types';

const RASTER_FORMATS: ReadonlySet<string> = new Set(IMPORTED_IMAGE_FORMATS);

/** Narrow a general local-dir resolution to raster images (or reject it). */
export function asRasterImage(info: LocalDirFile | undefined): LocalDirFile | undefined {
  if (!info) {
    return undefined;
  }
  const format = IMAGE_FORMAT_BY_EXT[path.extname(info.diskPath).slice(1).toLowerCase()];
  return format ? { diskPath: info.diskPath, contentType: IMAGE_MIME[format] } : undefined;
}

/** `resolveLocalDirFile`, raster-gated — what the transform pipeline may consume as a source. */
export function resolveLocalDirImage(pathname: string): LocalDirFile | undefined {
  return asRasterImage(resolveLocalDirFile(pathname));
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
  const info = asRasterImage(resolveLocalDirRef(normalized));
  if (!info) {
    const dirs = Object.keys(getLocalDirs());
    throw new Error(
      `localImage("${ref}"): not a resolvable local-dir image. Expected "<dir>/<relative path>" where <dir> is one of ` +
        `localDirs (${dirs.length ? dirs.map((d) => `"${d}"`).join(', ') : 'none configured'}) and the path stays ` +
        `inside its root with a raster-image extension (png, jpg, jpeg, webp, avif, gif). Dotfile paths are refused ` +
        `unless that dir sets includeDotfiles: true.`,
    );
  }
  const file = Bun.file(info.diskPath);
  if (!(await file.exists())) {
    throw new Error(`localImage("${ref}"): file not found at ${info.diskPath}`);
  }
  const src = `${getAssetPrefix()}/files/${normalized.split('/').map(encodeURIComponent).join('/')}`;
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
    throw new Error(`localImage("${ref}"): the file could not be decoded as an image. Only raster images (png, jpg, jpeg, webp, avif, gif) are supported.`);
  }
  if (!RASTER_FORMATS.has(meta.format)) {
    throw new Error(`localImage("${ref}"): unsupported format "${meta.format}". Supported: png, jpg, jpeg, webp, avif, gif.`);
  }
  const image: ImportedImage = { src, width: meta.width, height: meta.height, format: meta.format as ImportedImageFormat };
  metaCache().set(info.diskPath, { mtimeMs, size, image });
  return image;
}
