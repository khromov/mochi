import { getMochiConfig } from '../mochiConfig';
import { ImageCache } from './imageCache';
import type { ImageFormat, MochiImageOptions, ResolvedImageOptions } from './types';

const ALL_FORMATS: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];
const DEFAULT_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'];

export function resolveImageOptions(opts: MochiImageOptions | undefined): ResolvedImageOptions {
  const o = opts ?? {};
  return {
    enabled: o.enabled ?? true,
    cacheDir: o.cacheDir ?? './.mochi/image-cache',
    defaultFormat: o.defaultFormat ?? 'webp',
    defaultQuality: o.defaultQuality ?? 80,
    outputFormats: o.outputFormats ?? ALL_FORMATS,
    inputFormats: o.inputFormats ?? DEFAULT_INPUT_FORMATS,
    maxPixels: o.maxPixels ?? 50_000_000,
    autoOrient: o.autoOrient ?? true,
    allowedHosts: o.allowedHosts,
    blockPrivateNetworks: o.blockPrivateNetworks ?? true,
    fetchTimeoutMs: o.fetchTimeoutMs ?? 10_000,
    maxResponseBytes: o.maxResponseBytes ?? 20 * 1024 * 1024,
    timeToStale: o.timeToStale ?? 60_000,
    timeToEvict: o.timeToEvict ?? 86_400_000,
    browserMaxAge: o.browserMaxAge ?? 31_536_000,
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
    runtime = { options: resolved, cache: new ImageCache(resolved.cacheDir) };
    g[GLOBAL_KEY] = runtime;
  }
  return runtime;
}

/** The URL prefix the image endpoint is mounted under. Mirrors the server island endpoint. */
export function getImageAssetPrefix(): string {
  const { options } = getMochiConfig();
  return (options.assetPrefix as string | undefined) ?? '/_mochi';
}
