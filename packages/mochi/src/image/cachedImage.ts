import { getImageRuntime } from './config';
import { getCachedOriginal, getImagePlaceholder } from './getResizedImage';
import { pipelineVariantId } from './imageCache';
import { ImageError } from './types';
import type { ImageFormat } from './types';

/** A recorded chainable call — replayed against a real `Bun.Image` on a cache miss. */
interface Op {
  m: string;
  a: unknown[];
}

export interface CachedImageOptions {
  /** Decompression-bomb guard passed to `Bun.Image`. Defaults to the configured `maxPixels`. */
  maxPixels?: number;
  /** Apply EXIF orientation. Defaults to the configured `autoOrient`. */
  autoOrient?: boolean;
  /** Shared-original time-to-stale (ms). Defaults to the configured `timeToStale`. */
  timeToStale?: number;
  /** Shared-original time-to-evict (ms). Defaults to the configured `timeToEvict`. */
  timeToEvict?: number;
}

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  gif: 'image/gif',
};

// Cosmetic on-disk extension per format setter; the sidecar holds the authoritative contentType.
const EXT_FOR_ENCODER: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  heic: 'heic',
};

function isUnsupportedFormatError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ERR_IMAGE_FORMAT_UNSUPPORTED');
}

/**
 * A cached, chainable `Bun.Image` builder. Every transform/format call only
 * records settings; the pipeline runs (and its output is cached on disk) when a
 * terminal is awaited. Results live in the same store as `<Image>`/`getResizedImage`
 * — a hit skips the source fetch, decode, and encode entirely. Server-only.
 */
export class CachedImage {
  private ops: Op[] = [];

  constructor(
    private readonly src: string,
    private readonly opts: CachedImageOptions = {},
  ) {}

  private push(m: string, a: unknown[]): this {
    this.ops.push({ m, a });
    return this;
  }

  // Transforms — order-sensitive, recorded verbatim.
  resize(width: number, height?: number, options?: Bun.Image.ResizeOptions): this {
    return this.push('resize', options === undefined ? (height === undefined ? [width] : [width, height]) : [width, height, options]);
  }
  rotate(degrees: number): this {
    return this.push('rotate', [degrees]);
  }
  flip(): this {
    return this.push('flip', []);
  }
  flop(): this {
    return this.push('flop', []);
  }
  modulate(options: Bun.Image.ModulateOptions): this {
    return this.push('modulate', [options]);
  }

  // Format setters — the last one wins and determines the output encoding.
  jpeg(options?: { quality?: number; progressive?: boolean }): this {
    return this.push('jpeg', options === undefined ? [] : [options]);
  }
  png(options?: { compressionLevel?: number; palette?: boolean; colors?: number; dither?: boolean }): this {
    return this.push('png', options === undefined ? [] : [options]);
  }
  webp(options?: { quality?: number; lossless?: boolean }): this {
    return this.push('webp', options === undefined ? [] : [options]);
  }
  avif(options?: { quality?: number }): this {
    return this.push('avif', options === undefined ? [] : [options]);
  }
  heic(options?: { quality?: number }): this {
    return this.push('heic', options === undefined ? [] : [options]);
  }

  private variantId(): string {
    const { options } = getImageRuntime();
    return pipelineVariantId({
      src: this.src,
      maxPixels: this.opts.maxPixels ?? options.maxPixels,
      autoOrient: this.opts.autoOrient ?? options.autoOrient,
      ops: this.ops,
    });
  }

  // Extension of the last format setter (`bin` when the chain re-encodes the
  // source format). Deterministic from `ops`, so a later read rebuilds the path.
  private ext(): string {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const ext = EXT_FOR_ENCODER[this.ops[i]!.m];
      if (ext) {
        return ext;
      }
    }
    return 'bin';
  }

  // Encode-and-cache the recorded pipeline; every byte-family terminal funnels
  // through here so `bytes()`/`dataurl()`/… share one on-disk variant.
  private async resolve(): Promise<{ bytes: Uint8Array; contentType: string; width: number; height: number; format: string }> {
    const { cache, options } = getImageRuntime();
    const maxPixels = this.opts.maxPixels ?? options.maxPixels;
    const autoOrient = this.opts.autoOrient ?? options.autoOrient;

    const { entry } = await cache.getVariant(this.src, this.variantId(), this.ext(), async () => {
      const { bytes: srcBytes } = await getCachedOriginal(this.src, { timeToStale: this.opts.timeToStale, timeToEvict: this.opts.timeToEvict }, options, cache);
      let out: Uint8Array;
      let meta: Bun.Image.Metadata;
      try {
        let pipe = new Bun.Image(srcBytes, { maxPixels, autoOrient });
        for (const op of this.ops) {
          pipe = (pipe as unknown as Record<string, (...args: unknown[]) => Bun.Image>)[op.m]!(...op.a);
        }
        out = await pipe.bytes();
        meta = await new Bun.Image(out).metadata();
      } catch (err) {
        if (isUnsupportedFormatError(err)) {
          throw new ImageError(415, 'Output format unsupported on this platform');
        }
        throw new ImageError(500, 'Image transform failed');
      }
      return {
        bytes: out,
        contentType: MIME[meta.format] ?? 'application/octet-stream',
        width: meta.width,
        height: meta.height,
        format: meta.format as ImageFormat,
      };
    });
    return { bytes: entry.bytes, contentType: entry.meta.contentType, width: entry.meta.width, height: entry.meta.height, format: entry.meta.format };
  }

  // Terminals.
  async bytes(): Promise<Uint8Array> {
    return (await this.resolve()).bytes;
  }
  async buffer(): Promise<Buffer> {
    return Buffer.from((await this.resolve()).bytes);
  }
  async blob(): Promise<Blob> {
    const { bytes, contentType } = await this.resolve();
    return new Blob([bytes as unknown as BlobPart], { type: contentType });
  }
  async toBase64(): Promise<string> {
    return Buffer.from((await this.resolve()).bytes).toString('base64');
  }
  async dataurl(): Promise<string> {
    const { bytes, contentType } = await this.resolve();
    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  async metadata(): Promise<{ width: number; height: number; format: string }> {
    const { width, height, format } = await this.resolve();
    return { width, height, format };
  }

  /**
   * ThumbHash blur placeholder for the source. Derived from the source image
   * (not the recorded transforms, matching `Bun.Image#placeholder`), so it reuses
   * the shared per-source placeholder cache.
   */
  placeholder(): Promise<string | null> {
    return getImagePlaceholder(this.src);
  }
}

/** Create a cached, chainable `Bun.Image` pipeline for `src` (a URL or path). Server-only. */
export function cachedImage(src: string, opts?: CachedImageOptions): CachedImage {
  return new CachedImage(src, opts);
}
