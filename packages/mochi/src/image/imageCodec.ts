/**
 * Compact binary encoding for the image-request payload that travels (encrypted)
 * in the `?p=` query param. Replaces `JSON.stringify(req)` to keep the token
 * short: enums/booleans collapse into two control bytes, numbers become LEB128
 * varints, and the source URL is the trailing bytes. Fields that equal the
 * resolved server defaults are omitted and refilled on decode — the encoder
 * (`getResizedImage`/`getImage`) and decoder (`imageEndpoint`) share one process
 * and config, so the reconstruction is lossless.
 *
 * Layout (before encryption):
 *   byte 0  format(0-1) | fitFill(2) | autoOrient(3) | withoutEnlargement(4) | original(5) | hasWidth(6) | hasHeight(7)
 *   byte 1  hasQuality(0) | hasTimeToStale(1) | hasTimeToEvict(2) | reserved(3-7)
 *   [varint width] [varint height] [byte quality] [varint timeToStale] [varint timeToEvict]   (present per the bits)
 *   [utf-8 src ...]                                                                            (rest of buffer)
 */
import type { ImageFit, ImageFormat, ImageRequest, ResolvedImageOptions } from './types';

const FORMATS: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];

const FIT_FILL = 1 << 2;
const AUTO_ORIENT = 1 << 3;
const WITHOUT_ENLARGEMENT = 1 << 4;
const ORIGINAL = 1 << 5;
const HAS_WIDTH = 1 << 6;
const HAS_HEIGHT = 1 << 7;

const HAS_QUALITY = 1 << 0;
const HAS_TIME_TO_STALE = 1 << 1;
const HAS_TIME_TO_EVICT = 1 << 2;

function writeVarint(out: number[], value: number): void {
  // Numbers here (px, ms) fit in 53-bit safe integers; emit 7 bits at a time
  // using division rather than `>>>` so values above 2^32 still encode.
  let v = Math.trunc(value);
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
}

function readVarint(buf: Uint8Array, cursor: { i: number }): number {
  let result = 0;
  let shift = 1;
  for (;;) {
    if (cursor.i >= buf.length) {
      throw new Error('truncated varint');
    }
    const byte = buf[cursor.i++]!;
    result += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) {
      return result;
    }
    shift *= 128;
  }
}

export function packImageRequest(req: ImageRequest, resolved: ResolvedImageOptions): Uint8Array {
  const fmtIndex = Math.max(0, FORMATS.indexOf(req.format));

  const hasQuality = req.quality !== resolved.defaultQuality;
  const hasTimeToStale = req.timeToStale !== undefined && req.timeToStale !== resolved.timeToStale;
  const hasTimeToEvict = req.timeToEvict !== undefined && req.timeToEvict !== resolved.timeToEvict;

  let control = fmtIndex & 0b11;
  if (req.fit === 'fill') {
    control |= FIT_FILL;
  }
  if (req.autoOrient) {
    control |= AUTO_ORIENT;
  }
  if (req.withoutEnlargement) {
    control |= WITHOUT_ENLARGEMENT;
  }
  if (req.original) {
    control |= ORIGINAL;
  }
  if (req.width !== undefined) {
    control |= HAS_WIDTH;
  }
  if (req.height !== undefined) {
    control |= HAS_HEIGHT;
  }

  let control2 = 0;
  if (hasQuality) {
    control2 |= HAS_QUALITY;
  }
  if (hasTimeToStale) {
    control2 |= HAS_TIME_TO_STALE;
  }
  if (hasTimeToEvict) {
    control2 |= HAS_TIME_TO_EVICT;
  }

  const head: number[] = [control, control2];
  if (req.width !== undefined) {
    writeVarint(head, req.width);
  }
  if (req.height !== undefined) {
    writeVarint(head, req.height);
  }
  if (hasQuality) {
    head.push(req.quality & 0xff);
  }
  if (hasTimeToStale) {
    writeVarint(head, req.timeToStale!);
  }
  if (hasTimeToEvict) {
    writeVarint(head, req.timeToEvict!);
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

    const format = FORMATS[control & 0b11]!;
    const fit: ImageFit = control & FIT_FILL ? 'fill' : 'inside';

    const width = control & HAS_WIDTH ? readVarint(buf, cursor) : undefined;
    const height = control & HAS_HEIGHT ? readVarint(buf, cursor) : undefined;
    const quality = control2 & HAS_QUALITY ? buf[cursor.i++]! : resolved.defaultQuality;
    const timeToStale = control2 & HAS_TIME_TO_STALE ? readVarint(buf, cursor) : undefined;
    const timeToEvict = control2 & HAS_TIME_TO_EVICT ? readVarint(buf, cursor) : undefined;

    if (cursor.i > buf.length) {
      return null;
    }
    const src = Buffer.from(buf.buffer, buf.byteOffset + cursor.i, buf.length - cursor.i).toString('utf-8');

    const req: ImageRequest = { src, fit, format, quality, autoOrient: (control & AUTO_ORIENT) !== 0 };
    if (width !== undefined) {
      req.width = width;
    }
    if (height !== undefined) {
      req.height = height;
    }
    if (timeToStale !== undefined) {
      req.timeToStale = timeToStale;
    }
    if (timeToEvict !== undefined) {
      req.timeToEvict = timeToEvict;
    }
    if (control & WITHOUT_ENLARGEMENT) {
      req.withoutEnlargement = true;
    }
    if (control & ORIGINAL) {
      req.original = true;
    }
    return req;
  } catch {
    return null;
  }
}
