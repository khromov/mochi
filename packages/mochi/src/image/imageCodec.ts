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
 *   fmt(2) | fitFill(1) | ao(1) | noUp(1) | orig(1) | hasW(1) | hasH(1)   (byte 0)
 *   hasQ(1) | hasTs(1) | hasTe(1) | reserved(5)                           (byte 1)
 *   [u24 w] [u24 h] [u8 q] [u40 ts] [u40 te]   (present per the flags above)
 *   [u16 srcLen] [utf-8 src …]
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
  @Field(1) hasW!: boolean;
  @Field(1) hasH!: boolean;

  @Field(1) hasQ!: boolean;
  @Field(1) hasTs!: boolean;
  @Field(1) hasTe!: boolean;
  @Reserved(5) $reserved!: number;

  @Field(24, { presentWhen: (i: ImageRequestElement) => i.hasW }) width!: number;
  @Field(24, { presentWhen: (i: ImageRequestElement) => i.hasH }) height!: number;
  @Field(8, { presentWhen: (i: ImageRequestElement) => i.hasQ }) quality!: number;
  @Field(40, { presentWhen: (i: ImageRequestElement) => i.hasTs }) timeToStale!: number;
  @Field(40, { presentWhen: (i: ImageRequestElement) => i.hasTe }) timeToEvict!: number;

  @Field(16) srcLen!: number;
  @Field((i: ImageRequestElement) => i.srcLen, { string: { encoding: 'utf-8', nullTerminated: false } })
  src!: string;
}

export function packImageRequest(req: ImageRequest, resolved: ResolvedImageOptions): Uint8Array {
  const el = new ImageRequestElement();
  el.format = Math.max(0, FORMATS.indexOf(req.format));
  el.fitFill = req.fit === 'fill';
  el.autoOrient = req.autoOrient;
  el.withoutEnlargement = req.withoutEnlargement ?? false;
  el.original = req.original ?? false;

  el.hasW = req.width !== undefined;
  el.hasH = req.height !== undefined;
  el.hasQ = req.quality !== resolved.defaultQuality;
  el.hasTs = req.timeToStale !== resolved.timeToStale;
  el.hasTe = req.timeToEvict !== resolved.timeToEvict;

  if (el.hasW) {
    el.width = req.width!;
  }
  if (el.hasH) {
    el.height = req.height!;
  }
  if (el.hasQ) {
    el.quality = req.quality;
  }
  if (el.hasTs) {
    el.timeToStale = req.timeToStale;
  }
  if (el.hasTe) {
    el.timeToEvict = req.timeToEvict;
  }

  el.src = req.src;
  el.srcLen = Buffer.byteLength(req.src, 'utf-8');
  return el.serialize();
}

export function unpackImageRequest(buf: Uint8Array, resolved: ResolvedImageOptions): ImageRequest | null {
  try {
    const el = ImageRequestElement.deserialize(buf);

    const req: ImageRequest = {
      src: el.src,
      fit: el.fitFill ? 'fill' : 'inside',
      format: FORMATS[el.format]!,
      quality: el.hasQ ? el.quality : resolved.defaultQuality,
      autoOrient: el.autoOrient,
      timeToStale: el.hasTs ? el.timeToStale : resolved.timeToStale,
      timeToEvict: el.hasTe ? el.timeToEvict : resolved.timeToEvict,
    };
    if (el.hasW) {
      req.width = el.width;
    }
    if (el.hasH) {
      req.height = el.height;
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
