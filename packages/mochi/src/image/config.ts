import { createHash } from 'node:crypto';
import { getMochiConfig } from '../mochiConfig';
import { ImageCache } from './imageCache';
import type { ImageFormat, ImageSize, MochiImageOptions, ResolvedImageOptions, ResolvedImageSize } from './types';

const ALL_FORMATS: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];
const DEFAULT_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'];

function checkDimension(field: string, sizeName: string, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`Image size "${sizeName}": ${field} must be a positive number, got ${value}`);
  }
  return Math.round(value);
}

// JSON.stringify with object keys sorted at every depth, so the config hash is
// insensitive to key order (e.g. a reordered `modulate` object hashes the same).
function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

// The stamped hash covers every byte-affecting field, so redefining a size changes the cache key and ETag and
// re-renders its already-minted URLs.
function resolveSize(
  name: string,
  p: ImageSize,
  defaults: { format: ImageFormat; quality: number; autoOrient: boolean; maxPixels: number; outputFormats: ImageFormat[] },
): ResolvedImageSize {
  const format = p.format ?? defaults.format;
  if (!defaults.outputFormats.includes(format)) {
    throw new Error(`Image size "${name}": format "${format}" is not in outputFormats`);
  }
  const rawQuality = p.quality ?? defaults.quality;
  if (!Number.isFinite(rawQuality)) {
    throw new Error(`Image size "${name}": quality must be a finite number, got ${rawQuality}`);
  }
  const quality = Math.min(100, Math.max(1, Math.round(rawQuality)));
  if (p.rotate !== undefined && !Number.isFinite(p.rotate)) {
    throw new Error(`Image size "${name}": rotate must be a finite number, got ${p.rotate}`);
  }
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
  // Hash the byte-affecting fields (everything but name + the placeholder hash),
  // with keys canonicalized so identical configs always share a hash.
  const { name: _n, configHash: _h, ...bytesAffecting } = resolved;
  resolved.configHash = createHash('sha256').update(canonicalStringify(bytesAffecting)).digest('base64url').slice(0, 16);
  return resolved;
}

export function resolveImageOptions(opts: MochiImageOptions | undefined): ResolvedImageOptions {
  const o = opts ?? {};

  // Throw rather than ignore: excess-property checks only fire on object literals,
  // so a spread-in config would silently fall back to the default schedule.
  // TODO: Remove after a few versions — we don't expect old consumers.
  if ((o as { sweepIntervalMs?: unknown }).sweepIntervalMs !== undefined) {
    throw new Error(
      "Mochi.serve({ image }): `sweepIntervalMs` was replaced by `sweepCron`, a cron pattern. Use sweepCron: '0 * * * *' for the old hourly default, or sweepCron: false to disable the janitor.",
    );
  }

  const defaultFormat = o.defaultFormat ?? 'webp';
  const defaultQuality = o.defaultQuality ?? 80;
  const outputFormats = o.outputFormats ?? ALL_FORMATS;
  const maxPixels = o.maxPixels ?? 50_000_000;
  const autoOrient = o.autoOrient ?? true;

  // Null-prototype map: size names are arbitrary user strings, so a plain object
  // would resolve names like "toString" or "__proto__" through the prototype chain.
  const sizes: Record<string, ResolvedImageSize> = Object.create(null);
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
    // Normalised once here so nothing downstream has to re-test for an empty pattern.
    sweepCron: o.sweepCron === false || (typeof o.sweepCron === 'string' && o.sweepCron.trim() === '') ? false : (o.sweepCron ?? '0 * * * *'),
  };
}

interface ImageRuntime {
  options: ResolvedImageOptions;
  cache: ImageCache;
}

// Pinned on globalThis like `__mochi_config__`: compiled Svelte components each get their own bundled copy of this
// module yet must share one cache instance and the endpoint handler's resolved config.
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
  // Object.hasOwn guards a `sizes` that arrived as a plain object literal (tests,
  // user-constructed options) against prototype-chain hits like "constructor".
  return name !== undefined && Object.hasOwn(options.sizes, name) ? options.sizes[name] : undefined;
}

export function getImageAssetPrefix(): string {
  const { options } = getMochiConfig();
  return (options.assetPrefix as string | undefined) ?? '/_mochi';
}
