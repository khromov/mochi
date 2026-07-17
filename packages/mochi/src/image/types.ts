import type { Storage } from '../cache/cache';

export type ImageFormat = 'webp' | 'jpeg' | 'png' | 'avif';

/**
 * The object a local image import resolves to (`import hero from './hero.png'`).
 * `src` is a content-hashed, same-origin URL served from disk; `width`/`height`
 * are the image's intrinsic pixel dimensions and `format` its decoded format
 * (e.g. `'jpeg'`). Pass it to `<Image src={hero} …>` or drop `hero.src` into a
 * plain `<img>`.
 */
export interface ImportedImage {
  src: string;
  width: number;
  height: number;
  format: string;
}

/** An `ImportedImage` plus the build-time details needed to serve/transform it from disk. */
export interface LocalImageAsset extends ImportedImage {
  diskPath: string;
  contentType: string;
}

/** Resize fit. Bun.Image only accepts these two. */
export type ImageFit = 'inside' | 'fill';

/**
 * The request payload baked (encrypted) into every image URL. It carries only the
 * source URL and the *name* of a size declared in `Mochi.serve({ image: { sizes } })`
 * — never the transform config itself, which lives server-side. The payload is
 * packed into a compact binary token (see `imageCodec.ts`) then sealed with
 * authenticated encryption (see `payloadCrypto.ts`), so the source URL is neither
 * readable nor tamperable and callers can only reference sizes the server defined.
 */
export interface ImageRequest {
  src: string;
  /** Name of the named size to apply. Absent → serve the full-size original. */
  size?: string;
  /** Full-size original request: serve the cached origin bytes verbatim, no transform. */
  original?: true;
}

/**
 * A named image size, declared under `Mochi.serve({ image: { sizes: { … } } })`.
 * Transforms apply in a fixed order: resize → rotate → flip → flop → modulate →
 * format-encode. Callers reference the size by name; changing a size's
 * definition re-renders every URL that uses it (the config hash busts caches).
 */
export interface ImageSize {
  /** Target width in px. */
  width?: number;
  /** Target height in px. */
  height?: number;
  /** Resize fit. Default: `inside`. */
  fit?: ImageFit;
  /** Never upscale beyond the source's intrinsic size. */
  withoutEnlargement?: boolean;
  /** Rotate by degrees. */
  rotate?: number;
  /** Mirror vertically (top-bottom). */
  flip?: boolean;
  /** Mirror horizontally (left-right). */
  flop?: boolean;
  /** Brightness/saturation/hue/lightness adjustment. */
  modulate?: Bun.Image.ModulateOptions;
  /** Output format. Default: the configured `defaultFormat`. */
  format?: ImageFormat;
  /** Quality 1-100 (ignored for png). Default: the configured `defaultQuality`. */
  quality?: number;
  /** Apply EXIF orientation. Default: the configured `autoOrient`. */
  autoOrient?: boolean;
  /** Decompression-bomb guard passed to `Bun.Image`. Default: the configured `maxPixels`. */
  maxPixels?: number;
}

/** A size with every field resolved against the global defaults, plus a stable config hash. */
export interface ResolvedImageSize {
  name: string;
  width?: number;
  height?: number;
  fit: ImageFit;
  withoutEnlargement: boolean;
  rotate?: number;
  flip: boolean;
  flop: boolean;
  modulate?: Bun.Image.ModulateOptions;
  format: ImageFormat;
  quality: number;
  autoOrient: boolean;
  maxPixels: number;
  /** Digest of every byte-affecting field — folded into the cache key + ETag so a redefinition busts caches. */
  configHash: string;
}

/** Options for `invalidateImage(src, opts)`. */
export interface InvalidateImageOptions {
  /** Also mark the entry expired (next request re-fetches synchronously), not just stale. */
  hard?: boolean;
}

/**
 * Image API configuration, set under `Mochi.serve({ image: { … } })`.
 * Every field is optional; see `resolveImageOptions` for defaults.
 */
export interface MochiImageOptions {
  /** Mount the `/_mochi/image/*` endpoint. Default: `true`. */
  enabled?: boolean;
  /**
   * Named transform sizes, referenced by name from `<Image size>`,
   * `getImageUrl(src, name)`, and `getImage(src, name)`. Validated at startup.
   */
  sizes?: Record<string, ImageSize>;
  /** Disk cache directory. Must NOT be under `publicDir`. Default: `./.mochi/image-cache`. Ignored when `storage` is set. */
  cacheDir?: string;
  /**
   * Override the default `FileStorage(cacheDir)` cache backend — e.g. `new MemoryStorage({ maxAge })`
   * for an in-memory cache. See the "Custom cache storage" docs section for trade-offs.
   */
  storage?: Storage;
  /** Output format when the caller doesn't specify one. Default: `webp`. */
  defaultFormat?: ImageFormat;
  /** Default encode quality 1-100. Default: `80`. */
  defaultQuality?: number;
  /** Allowed output formats. Default: all four. */
  outputFormats?: ImageFormat[];
  /** Allowed decoded input formats (as reported by `Bun.Image#metadata`). Default: jpeg/png/webp/avif/gif. SVG is never allowed. */
  inputFormats?: string[];
  /** Decompression-bomb guard passed to `Bun.Image`. Default: `50_000_000`. */
  maxPixels?: number;
  /** Apply EXIF orientation by default. Default: `true`. */
  autoOrient?: boolean;
  /** Remote host allowlist (exact host or `*.example.com`). Default: undefined (any public host). */
  allowedHosts?: string[];
  /** Reject sources that resolve to private/loopback/link-local IPs. Default: `true`. */
  blockPrivateNetworks?: boolean;
  /** Upstream fetch timeout in ms. Default: `10_000`. */
  fetchTimeoutMs?: number;
  /** Max upstream response body in bytes. Default: `20 * 1024 * 1024`. */
  maxResponseBytes?: number;
  /** Cache time-to-stale in ms — governs the original; resized variants follow it. Default: `14_400_000` (4 h). */
  timeToStale?: number;
  /** Cache time-to-evict in ms — governs the original; resized variants follow it. Default: `86_400_000` (1 day). */
  timeToEvict?: number;
  /** Deflate-compress the encrypted URL payload when it shrinks it. Default: `true`. */
  compressPayload?: boolean;
  /** Interval (ms) for the background janitor that deletes evicted/orphaned cache entries. `0` disables it. Default: `3_600_000` (1h). */
  sweepIntervalMs?: number;
}

/** Fully-resolved options with every field present. */
export interface ResolvedImageOptions {
  enabled: boolean;
  sizes: Record<string, ResolvedImageSize>;
  cacheDir: string;
  storage?: Storage;
  defaultFormat: ImageFormat;
  defaultQuality: number;
  outputFormats: ImageFormat[];
  inputFormats: string[];
  maxPixels: number;
  autoOrient: boolean;
  allowedHosts: string[] | undefined;
  blockPrivateNetworks: boolean;
  fetchTimeoutMs: number;
  maxResponseBytes: number;
  timeToStale: number;
  timeToEvict: number;
  compressPayload: boolean;
  sweepIntervalMs: number;
}

/** Error carrying the HTTP status the endpoint should return. */
export class ImageError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ImageError';
  }
}
