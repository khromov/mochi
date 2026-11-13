import { ImageError } from './types';
import type { ImageFormat, ResolvedImageOptions, ResolvedImageSize } from './types';

function imageCtor(): typeof Bun.Image {
  const ctor = (Bun as { Image?: typeof Bun.Image }).Image;
  if (!ctor) {
    throw new ImageError(500, 'Bun.Image is unavailable; Bun >= 1.4.0 is required');
  }
  return ctor;
}

const MIME: Record<ImageFormat, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
};

const EXT: Record<ImageFormat, string> = {
  webp: 'webp',
  jpeg: 'jpg',
  png: 'png',
  avif: 'avif',
};

export function extForFormat(format: ImageFormat): string {
  return EXT[format];
}

function isUnsupportedFormatError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ERR_IMAGE_FORMAT_UNSUPPORTED');
}

export interface ResizeResult {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  format: ImageFormat;
}

/**
 * Run a named size against source bytes: resize → rotate → flip → flop →
 * modulate → format-encode, in that fixed order. Shared by the endpoint (deferred
 * URL path) and the inline `getImage()` API — both feed it a resolved size.
 */
export async function runPipeline(input: Uint8Array, size: ResolvedImageSize, opts: ResolvedImageOptions): Promise<ResizeResult> {
  const Image = imageCtor();

  let img: Bun.Image;
  try {
    img = new Image(input, { maxPixels: size.maxPixels, autoOrient: size.autoOrient });
  } catch (err) {
    if (isUnsupportedFormatError(err)) {
      throw new ImageError(415, 'Unsupported image format');
    }
    throw new ImageError(422, 'Could not decode source image');
  }

  let meta: Bun.Image.Metadata;
  try {
    meta = await img.metadata();
  } catch {
    throw new ImageError(415, 'Unsupported image format');
  }

  if (!opts.inputFormats.includes(meta.format)) {
    throw new ImageError(415, `Input format "${meta.format}" is not allowed`);
  }

  // Bun.Image#resize requires width first; derive it from the aspect ratio for
  // height-only sizes.
  let width = size.width;
  const height = size.height;
  if (!width && height && meta.height > 0) {
    width = Math.max(1, Math.round(meta.width * (height / meta.height)));
  }

  let pipe = img;
  if (width) {
    const resizeOpts: Bun.Image.ResizeOptions = { fit: size.fit };
    if (size.withoutEnlargement) {
      resizeOpts.withoutEnlargement = true;
    }
    pipe = height ? pipe.resize(width, height, resizeOpts) : pipe.resize(width, undefined, resizeOpts);
  }
  if (size.rotate !== undefined) {
    pipe = pipe.rotate(size.rotate);
  }
  if (size.flip) {
    pipe = pipe.flip();
  }
  if (size.flop) {
    pipe = pipe.flop();
  }
  if (size.modulate) {
    pipe = pipe.modulate(size.modulate);
  }

  switch (size.format) {
    case 'webp':
      pipe = pipe.webp({ quality: size.quality });
      break;
    case 'jpeg':
      pipe = pipe.jpeg({ quality: size.quality });
      break;
    case 'avif':
      pipe = pipe.avif({ quality: size.quality });
      break;
    case 'png':
      pipe = pipe.png();
      break;
  }

  let out: Uint8Array;
  try {
    out = await pipe.bytes();
  } catch (err) {
    if (isUnsupportedFormatError(err)) {
      throw new ImageError(415, 'Output format unsupported on this platform');
    }
    throw new ImageError(500, 'Image encode failed');
  }

  let outMeta: Bun.Image.Metadata;
  try {
    outMeta = await new Image(out).metadata();
  } catch {
    outMeta = { width: width ?? meta.width, height: height ?? meta.height, format: size.format };
  }

  return {
    bytes: out,
    contentType: MIME[size.format],
    width: outMeta.width,
    height: outMeta.height,
    format: size.format,
  };
}

export async function computePlaceholder(input: Uint8Array, opts: ResolvedImageOptions): Promise<string> {
  const Image = imageCtor();
  try {
    return await new Image(input, { maxPixels: opts.maxPixels }).placeholder();
  } catch {
    throw new ImageError(422, 'Could not compute placeholder');
  }
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/** A source's display dimensions (EXIF orientation applied); `transposed` when that orientation swaps the stored axes. */
export interface SourceDimensions extends ImageDimensions {
  transposed: boolean;
}

/** Header-only probe of a source's dimensions; `undefined` for anything `Bun.Image` can't read (SVG, corrupt bytes). */
export async function probeSourceDimensions(input: Uint8Array): Promise<SourceDimensions | undefined> {
  try {
    const Image = imageCtor();
    const oriented = await new Image(input, { autoOrient: true }).metadata();
    const raw = await new Image(input, { autoOrient: false }).metadata();
    if (oriented.width <= 0 || oriented.height <= 0) {
      return undefined;
    }
    return { width: oriented.width, height: oriented.height, transposed: oriented.width !== raw.width };
  } catch {
    return undefined;
  }
}

/**
 * The dimensions {@link runPipeline} will produce for `size` from a source of the given dimensions, without decoding
 * or encoding anything, so `<Image>` can size its box before the variant exists. Mirrors `Bun.Image`'s actual
 * arithmetic, which differs from the documented order: it rotates before resizing, floors a width-only resize's derived
 * height, and skips a `fill` + `withoutEnlargement` resize outright when either axis would grow. `null` when a
 * non-right-angle `rotate` makes the output canvas unpredictable.
 */
export function predictVariantDimensions(source: SourceDimensions, size: ResolvedImageSize): ImageDimensions | null {
  const swap = source.transposed && !size.autoOrient;
  const metaWidth = swap ? source.height : source.width;
  const metaHeight = swap ? source.width : source.height;
  const turn = size.rotate === undefined ? 0 : ((size.rotate % 360) + 360) % 360;
  if (turn % 90 !== 0) {
    return null;
  }
  const quarter = turn === 90 || turn === 270;
  const sw = quarter ? metaHeight : metaWidth;
  const sh = quarter ? metaWidth : metaHeight;

  let width = size.width;
  const height = size.height;
  if (!width && height) {
    width = Math.max(1, Math.round(metaWidth * (height / metaHeight)));
  }
  if (!width) {
    return { width: sw, height: sh };
  }
  const boxHeight = height ?? Math.max(1, Math.floor((sh * width) / sw));
  if (size.fit === 'fill') {
    return size.withoutEnlargement && (width > sw || boxHeight > sh) ? { width: sw, height: sh } : { width, height: boxHeight };
  }
  const scale = Math.min(width / sw, boxHeight / sh, size.withoutEnlargement ? 1 : Infinity);
  return { width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) };
}
