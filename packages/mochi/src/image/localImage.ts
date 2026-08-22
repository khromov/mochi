/**
 * Images served from a `staticDirs` mount. Bun resolves a directory route per request, so a file written after boot is
 * served immediately — `localImage` probes one and returns the shape a build-time import gives, letting `<Image>` and
 * the transform pipeline consume runtime files without a registration step.
 */
import path from 'node:path';
import { getMochiConfig } from '../mochiConfig';
import { resolveStaticDirs } from '../runtime/staticDirs';
import { normalizeAssetPrefix } from '../utils';
import { IMAGE_FORMAT_BY_EXT, IMAGE_MIME, IMPORTED_IMAGE_FORMATS } from './types';
import type { ImportedImage, ImportedImageFormat } from './types';

const RASTER_FORMATS: ReadonlySet<string> = new Set(IMPORTED_IMAGE_FORMATS);

export interface LocalImageFile {
  diskPath: string;
  contentType: string;
}

interface Mount {
  prefix: string;
  dir: string;
}

// Pinned on globalThis (like __mochi_config__): compiled SSR components get their own bundled copy of this module but
// must share one resolved mount list.
const MOUNTS_KEY = '__mochi_static_image_mounts__';

function mounts(): Mount[] {
  const g = globalThis as unknown as Record<string, unknown>;
  let list = g[MOUNTS_KEY] as Mount[] | undefined;
  if (!list) {
    const { options } = getMochiConfig();
    list = (options.staticDirs ? resolveStaticDirs(options.staticDirs, normalizeAssetPrefix(options.assetPrefix)) : [])
      .map(({ pattern, dir }) => ({ prefix: pattern.slice(0, -2), dir }))
      // Longest prefix first, so a mount nested inside another still resolves against its own root.
      .sort((a, b) => b.prefix.length - a.prefix.length);
    g[MOUNTS_KEY] = list;
  }
  return list;
}

const NO_MOUNTS: Mount[] = [];

/**
 * Like `mounts`, but before `Mochi.serve()` has initialized the config there are simply no mounts — for callers (the
 * image fetch path) that must not fail on an uninitialized server.
 */
function peekMounts(): Mount[] {
  return (globalThis as unknown as Record<string, unknown>)['__mochi_config__'] ? mounts() : NO_MOUNTS;
}

/** Resolve a site-relative URL path to the disk file a `staticDirs` mount serves it from. */
function resolveMounted(urlPath: string): string | undefined {
  if (!urlPath.startsWith('/') || urlPath.includes('\0')) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  for (const { prefix, dir } of peekMounts()) {
    if (!decoded.startsWith(`${prefix}/`)) {
      continue;
    }
    const rel = decoded.slice(prefix.length + 1);
    const diskPath = path.resolve(dir, rel);
    // The relative-path check catches every escape (`../`, absolute rel, and on Windows backslash separators or
    // drive-letter jumps) in one place.
    const escape = path.relative(dir, diskPath);
    if (escape === '' || escape === '..' || escape.startsWith(`..${path.sep}`) || path.isAbsolute(escape)) {
      return undefined;
    }
    return diskPath;
  }
  return undefined;
}

/** `resolveMounted`, raster-gated — what the transform pipeline may consume as a source. */
export function resolveStaticDirImage(urlPath: string): LocalImageFile | undefined {
  const diskPath = resolveMounted(urlPath);
  if (!diskPath) {
    return undefined;
  }
  const format = IMAGE_FORMAT_BY_EXT[path.extname(diskPath).slice(1).toLowerCase()];
  return format ? { diskPath, contentType: IMAGE_MIME[format] } : undefined;
}

interface ProbedMeta {
  mtimeMs: number;
  size: number;
  image: ImportedImage;
}

const META_KEY = '__mochi_static_image_meta__';

function metaCache(): Map<string, ProbedMeta> {
  const g = globalThis as unknown as Record<string, unknown>;
  let map = g[META_KEY] as Map<string, ProbedMeta> | undefined;
  if (!map) {
    map = new Map();
    g[META_KEY] = map;
  }
  return map;
}

function encodeUrlPath(urlPath: string): string {
  return urlPath
    .split('/')
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join('/');
}

/**
 * Probe an image served from a `staticDirs` mount by its URL path and return the same `{ src, width, height, format }`
 * shape a build-time import resolves to — usable with `<Image>`, `getImageUrl`, and plain `<img>`. Server-only. Probes
 * are memoized per disk path and revalidated by mtime+size, so a replaced file re-probes while repeated renders stay
 * cheap.
 */
export async function localImage(urlPath: string): Promise<ImportedImage> {
  const info = resolveStaticDirImage(urlPath);
  if (!info) {
    const prefixes = mounts().map((m) => `"${m.prefix}"`);
    throw new Error(
      `localImage("${urlPath}"): not an image served by a staticDirs mount. Expected a URL path under one of ` +
        `${prefixes.length ? prefixes.join(', ') : 'staticDirs (none configured)'}, staying inside its root, with a ` +
        `raster-image extension (png, jpg, jpeg, webp, avif, gif).`,
    );
  }
  const file = Bun.file(info.diskPath);
  if (!(await file.exists())) {
    throw new Error(`localImage("${urlPath}"): file not found at ${info.diskPath}`);
  }
  const src = encodeUrlPath(urlPath);
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
    throw new Error(`localImage("${urlPath}"): the file could not be decoded as an image. Only raster images (png, jpg, jpeg, webp, avif, gif) are supported.`);
  }
  if (!RASTER_FORMATS.has(meta.format)) {
    throw new Error(`localImage("${urlPath}"): unsupported format "${meta.format}". Supported: png, jpg, jpeg, webp, avif, gif.`);
  }
  const image: ImportedImage = { src, width: meta.width, height: meta.height, format: meta.format as ImportedImageFormat };
  metaCache().set(info.diskPath, { mtimeMs, size, image });
  return image;
}
