import { ImageError } from './types';
import type { ImageFormat, ImageRequest, ResolvedImageOptions } from './types';

function imageCtor(): typeof Bun.Image {
  const ctor = (Bun as { Image?: typeof Bun.Image }).Image;
  if (!ctor) {
    throw new ImageError(500, 'Bun.Image is unavailable; Bun >= 1.3.14 is required');
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

export async function resizeImage(input: Uint8Array, req: ImageRequest, opts: ResolvedImageOptions): Promise<ResizeResult> {
  const Image = imageCtor();

  let img: Bun.Image;
  try {
    img = new Image(input, { maxPixels: opts.maxPixels, autoOrient: req.autoOrient });
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
  // height-only requests.
  let width = req.width;
  const height = req.height;
  if (!width && height && meta.height > 0) {
    width = Math.max(1, Math.round(meta.width * (height / meta.height)));
  }

  let pipe = img;
  if (width) {
    const resizeOpts: Bun.Image.ResizeOptions = { fit: req.fit };
    if (req.withoutEnlargement) {
      resizeOpts.withoutEnlargement = true;
    }
    pipe = height ? img.resize(width, height, resizeOpts) : img.resize(width, undefined, resizeOpts);
  }

  switch (req.format) {
    case 'webp':
      pipe = pipe.webp({ quality: req.quality });
      break;
    case 'jpeg':
      pipe = pipe.jpeg({ quality: req.quality });
      break;
    case 'avif':
      pipe = pipe.avif({ quality: req.quality });
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
    outMeta = { width: width ?? meta.width, height: height ?? meta.height, format: req.format };
  }

  return {
    bytes: out,
    contentType: MIME[req.format],
    width: outMeta.width,
    height: outMeta.height,
    format: req.format,
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
