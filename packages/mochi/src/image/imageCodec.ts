/**
 * Compact binary encoding for the image-request payload that travels (encrypted)
 * in the `?p=` query param. Replaces `JSON.stringify(req)` to keep the token
 * short. The layout is described declaratively as a `@astronautlabs/bitstream`
 * element rather than hand-packed: enums/booleans collapse into individual
 * bit-fields, presence flags drive `presentWhen` so fields equal to the resolved
 * server defaults are omitted, and the source URL is a length-prefixed trailing
 * string. The encoder (`getResizedImage`/`getImage`) and decoder
 * (`imageEndpoint`) share one process and config, so the reconstruction is
 * lossless.
 *
 * Layout (before encryption), big-endian, bit-packed:
 *   format(2) | fitFill(1) | autoOrient(1) | withoutEnlargement(1) | original(1) | hasWidth(1) | hasHeight(1)   (byte 0)
 *   hasQuality(1) | hasTimeToStale(1) | hasTimeToEvict(1) | reserved(5)                                        (byte 1)
 *   [u24 width] [u24 height] [u8 quality] [u40 timeToStale] [u40 timeToEvict]   (present per the flags above)
 *   [u16 srcByteLength] [utf-8 src …]
 */
import 'reflect-metadata'; // must load before the element class below is defined
import { BitstreamElement, Field, Reserved } from '@astronautlabs/bitstream';
import type { ImageFormat, ImageRequest, ResolvedImageOptions } from './types';

const FORMATS: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];

class ImageRequestElement extends BitstreamElement {
  @Field(2) format!: number;
  @Field(1) fitFill!: boolean;
  @Field(1) autoOrient!: boolean;
  @Field(1) withoutEnlargement!: boolean;
  @Field(1) original!: boolean;
  @Field(1) hasWidth!: boolean;
  @Field(1) hasHeight!: boolean;

  @Field(1) hasQuality!: boolean;
  @Field(1) hasTimeToStale!: boolean;
  @Field(1) hasTimeToEvict!: boolean;
  @Reserved(5) $reserved!: number;

  @Field(24, { presentWhen: (i: ImageRequestElement) => i.hasWidth }) width!: number;
  @Field(24, { presentWhen: (i: ImageRequestElement) => i.hasHeight }) height!: number;
  @Field(8, { presentWhen: (i: ImageRequestElement) => i.hasQuality }) quality!: number;
  @Field(40, { presentWhen: (i: ImageRequestElement) => i.hasTimeToStale }) timeToStale!: number;
  @Field(40, { presentWhen: (i: ImageRequestElement) => i.hasTimeToEvict }) timeToEvict!: number;

  @Field(16) srcByteLength!: number;
  @Field((i: ImageRequestElement) => i.srcByteLength, { string: { encoding: 'utf-8', nullTerminated: false } })
  src!: string;
}

export function packImageRequest(req: ImageRequest, resolved: ResolvedImageOptions): Uint8Array {
  const el = new ImageRequestElement();
  el.format = Math.max(0, FORMATS.indexOf(req.format));
  el.fitFill = req.fit === 'fill';
  el.autoOrient = req.autoOrient;
  el.withoutEnlargement = req.withoutEnlargement ?? false;
  el.original = req.original ?? false;

  el.hasWidth = req.width !== undefined;
  el.hasHeight = req.height !== undefined;
  el.hasQuality = req.quality !== resolved.defaultQuality;
  el.hasTimeToStale = req.timeToStale !== undefined && req.timeToStale !== resolved.timeToStale;
  el.hasTimeToEvict = req.timeToEvict !== undefined && req.timeToEvict !== resolved.timeToEvict;

  if (el.hasWidth) {
    el.width = req.width!;
  }
  if (el.hasHeight) {
    el.height = req.height!;
  }
  if (el.hasQuality) {
    el.quality = req.quality;
  }
  if (el.hasTimeToStale) {
    el.timeToStale = req.timeToStale!;
  }
  if (el.hasTimeToEvict) {
    el.timeToEvict = req.timeToEvict!;
  }

  el.src = req.src;
  el.srcByteLength = Buffer.byteLength(req.src, 'utf-8');
  return el.serialize();
}

export function unpackImageRequest(buf: Uint8Array, resolved: ResolvedImageOptions): ImageRequest | null {
  try {
    const el = ImageRequestElement.deserialize(buf);

    const req: ImageRequest = {
      src: el.src,
      fit: el.fitFill ? 'fill' : 'inside',
      format: FORMATS[el.format]!,
      quality: el.hasQuality ? el.quality : resolved.defaultQuality,
      autoOrient: el.autoOrient,
    };
    if (el.hasWidth) {
      req.width = el.width;
    }
    if (el.hasHeight) {
      req.height = el.height;
    }
    if (el.hasTimeToStale) {
      req.timeToStale = el.timeToStale;
    }
    if (el.hasTimeToEvict) {
      req.timeToEvict = el.timeToEvict;
    }
    if (el.withoutEnlargement) {
      req.withoutEnlargement = true;
    }
    if (el.original) {
      req.original = true;
    }
    return req;
  } catch {
    return null;
  }
}
