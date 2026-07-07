import { createHash } from 'node:crypto';
import { getMochiConfig } from '../mochiConfig';
import { ImageCache } from './imageCache';
import type { ImageFormat, ImageSize, MochiImageOptions, ResolvedImageOptions, ResolvedImageSize } from './types';

const ALL_FORMATS: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];
const DEFAULT_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'];

function checkDimension(name: string, pipe: string, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`Image size "${pipe}": ${name} must be a positive number, got ${value}`);
  }
  return Math.round(value);
}

/**
 * Resolve one named size against the global defaults and stamp a config hash.
 * The hash covers every byte-affecting field so redefining a size changes the
 * cache key + ETag and re-renders its already-minted URLs.
 */
function resolveSize(
  name: string,
  p: ImageSize,
  defaults: { format: ImageFormat; quality: number; autoOrient: boolean; maxPixels: number; outputFormats: ImageFormat[] },
): ResolvedImageSize {
  const format = p.format ?? defaults.format;
  if (!defaults.outputFormats.includes(format)) {
    throw new Error(`Image size "${name}": format "${format}" is not in outputFormats`);
  }
  const quality = Math.min(100, Math.max(1, Math.round(p.quality ?? defaults.quality)));
  const resolved: ResolvedImageSize = {
    name,
    width: checkDimension('width', name, p.width),
    height: checkDimension('height', name, p.height),
    fit: p.fit ?? 'inside',
    withoutEnlargement: p.withoutEnlargement ?? false,
    rotate: p.rotate,
    flip: p.flip ?? false,
    flop: p.flop ?? false,
    modulate: p.modulate,
    format,
    quality,
    autoOrient: p.autoOrient ?? defaults.autoOrient,
    maxPixels: p.maxPixels ?? defaults.maxPixels,
    configHash: '',
  };
  // Hash the byte-affecting fields (everything but name + the placeholder hash).
  const { name: _n, configHash: _h, ...bytesAffecting } = resolved;
  resolved.configHash = createHash('sha256').update(JSON.stringify(bytesAffecting)).digest('base64url').slice(0, 16);
  return resolved;
}

export function resolveImageOptions(opts: MochiImageOptions | undefined): ResolvedImageOptions {
  const o = opts ?? {};
  const defaultFormat = o.defaultFormat ?? 'webp';
  const defaultQuality = o.defaultQuality ?? 80;
  const outputFormats = o.outputFormats ?? ALL_FORMATS;
  const maxPixels = o.maxPixels ?? 50_000_000;
  const autoOrient = o.autoOrient ?? true;

  const sizes: Record<string, ResolvedImageSize> = {};
  for (const [name, p] of Object.entries(o.sizes ?? {})) {
    sizes[name] = resolveSize(name, p, { format: defaultFormat, quality: defaultQuality, autoOrient, maxPixels, outputFormats });
  }

  return {
    enabled: o.enabled ?? true,
    sizes,
    cacheDir: o.cacheDir ?? './.mochi/image-cache',
    storage: o.storage,
    defaultFormat,
    defaultQuality,
    outputFormats,
    inputFormats: o.inputFormats ?? DEFAULT_INPUT_FORMATS,
    maxPixels,
    autoOrient,
    allowedHosts: o.allowedHosts,
    blockPrivateNetworks: o.blockPrivateNetworks ?? true,
    fetchTimeoutMs: o.fetchTimeoutMs ?? 10_000,
    maxResponseBytes: o.maxResponseBytes ?? 20 * 1024 * 1024,
    timeToStale: o.timeToStale ?? 14_400_000,
    timeToEvict: o.timeToEvict ?? 86_400_000,
    compressPayload: o.compressPayload ?? true,
    sweepIntervalMs: o.sweepIntervalMs ?? 3_600_000,
  };
}

interface ImageRuntime {
  options: ResolvedImageOptions;
  cache: ImageCache;
}

// Pinned on globalThis like __mochi_config__: compiled Svelte components get
// their own bundled copy of this module, but must share one cache instance and
// the same resolved config as the endpoint handler in the main bundle.
const GLOBAL_KEY = '__mochi_image_runtime__';

export function getImageRuntime(): ImageRuntime {
  const g = globalThis as unknown as Record<string, unknown>;
  let runtime = g[GLOBAL_KEY] as ImageRuntime | undefined;
  if (!runtime) {
    const { options } = getMochiConfig();
    const resolved = resolveImageOptions(options.image as MochiImageOptions | undefined);
    runtime = {
      options: resolved,
      cache: new ImageCache({
        cacheDir: resolved.cacheDir,
        minTimeToStale: resolved.timeToStale,
        maxTimeToLive: resolved.timeToEvict,
        sizes: resolved.sizes,
        storage: resolved.storage,
      }),
    };
    g[GLOBAL_KEY] = runtime;
  }
  return runtime;
}

/** Look up a resolved named size, or `undefined` if the name is unknown/absent. */
export function getSize(name: string | undefined, options: ResolvedImageOptions): ResolvedImageSize | undefined {
  return name === undefined ? undefined : options.sizes[name];
}

export function getImageAssetPrefix(): string {
  const { options } = getMochiConfig();
  return (options.assetPrefix as string | undefined) ?? '/_mochi';
}
