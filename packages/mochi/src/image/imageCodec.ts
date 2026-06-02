/**
 * Compact binary encoding for the image-request payload that travels (encrypted)
 * in the `?p=` query param. Replaces `JSON.stringify(req)` to keep the token
 * short: enums/booleans collapse into two control bytes, numbers become LEB128
 * varints (via the `leb` package), and the source URL is the trailing bytes.
 * Fields that equal the resolved server defaults are omitted and refilled on
 * decode — the encoder (`getResizedImage`/`getImage`) and decoder
 * (`imageEndpoint`) share one process and config, so the reconstruction is
 * lossless.
 *
 * Layout (before encryption):
 *   byte 0  fmt(0-1) | fit(2) | ao(3) | noUp(4) | orig(5) | hasW(6) | hasH(7)
 *   byte 1  hasQ(0) | hasTs(1) | hasTe(2) | reserved(3-7)
 *   [varint w] [varint h] [byte q] [varint ts] [varint te]   (present per the bits)
 *   [utf-8 src ...]                                           (rest of buffer)
 */
import { decodeUInt64, encodeUInt64 } from 'leb';
import type { ImageFit, ImageFormat, ImageRequest, ResolvedImageOptions } from './types';

const FORMATS: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];

const FIT_FILL = 1 << 2;
const AO = 1 << 3;
const NO_UP = 1 << 4;
const ORIG = 1 << 5;
const HAS_W = 1 << 6;
const HAS_H = 1 << 7;

const HAS_Q = 1 << 0;
const HAS_TS = 1 << 1;
const HAS_TE = 1 << 2;

export function packImageRequest(req: ImageRequest, resolved: ResolvedImageOptions): Uint8Array {
  const fmtIndex = Math.max(0, FORMATS.indexOf(req.format));

  const hasQ = req.quality !== resolved.defaultQuality;
  const hasTs = req.timeToStale !== resolved.timeToStale;
  const hasTe = req.timeToEvict !== resolved.timeToEvict;

  let control = fmtIndex & 0b11;
  if (req.fit === 'fill') {
    control |= FIT_FILL;
  }
  if (req.autoOrient) {
    control |= AO;
  }
  if (req.withoutEnlargement) {
    control |= NO_UP;
  }
  if (req.original) {
    control |= ORIG;
  }
  if (req.width !== undefined) {
    control |= HAS_W;
  }
  if (req.height !== undefined) {
    control |= HAS_H;
  }

  let control2 = 0;
  if (hasQ) {
    control2 |= HAS_Q;
  }
  if (hasTs) {
    control2 |= HAS_TS;
  }
  if (hasTe) {
    control2 |= HAS_TE;
  }

  const head: number[] = [control, control2];
  if (req.width !== undefined) {
    head.push(...encodeUInt64(req.width));
  }
  if (req.height !== undefined) {
    head.push(...encodeUInt64(req.height));
  }
  if (hasQ) {
    head.push(req.quality & 0xff);
  }
  if (hasTs) {
    head.push(...encodeUInt64(req.timeToStale));
  }
  if (hasTe) {
    head.push(...encodeUInt64(req.timeToEvict));
  }

  const src = Buffer.from(req.src, 'utf-8');
  const out = new Uint8Array(head.length + src.length);
  out.set(head, 0);
  out.set(src, head.length);
  return out;
}

export function unpackImageRequest(buf: Uint8Array, resolved: ResolvedImageOptions): ImageRequest | null {
  try {
    if (buf.length < 2) {
      return null;
    }
    const control = buf[0]!;
    const control2 = buf[1]!;
    const cursor = { i: 2 };
    const readUint = (): number => {
      const { value, nextIndex } = decodeUInt64(buf, cursor.i);
      cursor.i = nextIndex;
      return value;
    };

    const format = FORMATS[control & 0b11]!;
    const fit: ImageFit = control & FIT_FILL ? 'fill' : 'inside';

    const width = control & HAS_W ? readUint() : undefined;
    const height = control & HAS_H ? readUint() : undefined;
    const quality = control2 & HAS_Q ? buf[cursor.i++]! : resolved.defaultQuality;
    const timeToStale = control2 & HAS_TS ? readUint() : resolved.timeToStale;
    const timeToEvict = control2 & HAS_TE ? readUint() : resolved.timeToEvict;

    if (cursor.i > buf.length) {
      return null;
    }
    const src = Buffer.from(buf.buffer, buf.byteOffset + cursor.i, buf.length - cursor.i).toString('utf-8');

    const req: ImageRequest = { src, fit, format, quality, autoOrient: (control & AO) !== 0, timeToStale, timeToEvict };
    if (width !== undefined) {
      req.width = width;
    }
    if (height !== undefined) {
      req.height = height;
    }
    if (control & NO_UP) {
      req.withoutEnlargement = true;
    }
    if (control & ORIG) {
      req.original = true;
    }
    return req;
  } catch {
    return null;
  }
}
