export type ImageFormat = 'webp' | 'jpeg' | 'png' | 'avif';

/** Resize fit. Bun.Image only accepts these two. */
export type ImageFit = 'inside' | 'fill';

/**
 * The request payload baked (encrypted) into every image URL. Compact keys keep
 * the URL short. The whole object is sealed with AES-256-GCM, so the source URL
 * and params are neither readable nor tamperable.
 */
export interface ImageRequest {
  src: string;
  /** Target width in px. */
  w?: number;
  /** Target height in px. */
  h?: number;
  /** Resize fit (defaults applied at sign time). */
  fit: ImageFit;
  /** Never upscale beyond the source's intrinsic size. */
  noUp?: boolean;
  /** Output format. */
  fmt: ImageFormat;
  /** Quality 1-100 (ignored for png). */
  q: number;
  /** Apply EXIF orientation. */
  ao: boolean;
  /** Time-to-stale in ms. */
  ts: number;
  /** Time-to-evict in ms. */
  te: number;
  /** Full-size original request: serve the cached origin bytes verbatim, no resize. Resize fields above are ignored. */
  orig?: true;
}

/** Per-call options accepted by `getResizedImage(src, opts)` and `<Image>`. */
export interface ResizeImageOptions {
  width?: number;
  height?: number;
  fit?: ImageFit;
  /** Never upscale beyond the source's intrinsic size. */
  withoutEnlargement?: boolean;
  format?: ImageFormat;
  quality?: number;
  autoOrient?: boolean;
}

/** Options for `invalidateImage(src, opts)`. */
export interface InvalidateImageOptions {
  /** Also mark the entry expired (next request re-fetches synchronously), not just stale. */
  hard?: boolean;
}

/**
 * Per-call options accepted by `getImage(src, opts)` and `getImageBytes(src, opts)`.
 * These set the shared original's cache window (shortest requested wins).
 */
export interface OriginalImageOptions {
  /** Override the configured time-to-stale (ms). */
  timeToStale?: number;
  /** Override the configured time-to-evict (ms). */
  timeToEvict?: number;
}

/**
 * Image API configuration, set under `Mochi.serve({ image: { … } })`.
 * Every field is optional; see `resolveImageOptions` for defaults.
 */
export interface MochiImageOptions {
  /** Mount the `/_mochi/image/*` endpoint. Default: `true`. */
  enabled?: boolean;
  /** Disk cache directory. Must NOT be under `publicDir`. Default: `./.mochi/image-cache`. */
  cacheDir?: string;
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
  /** Cache time-to-stale in ms — governs the original; resized variants follow it. Default: `60_000`. */
  timeToStale?: number;
  /** Cache time-to-evict in ms — governs the original; resized variants follow it. Default: `86_400_000` (1 day). */
  timeToEvict?: number;
  /** Deflate-compress the encrypted URL payload when it shrinks it. Default: `true`. */
  compressPayload?: boolean;
}

/** Fully-resolved options with every field present. */
export interface ResolvedImageOptions {
  enabled: boolean;
  cacheDir: string;
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
