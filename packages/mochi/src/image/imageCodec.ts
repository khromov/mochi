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
 *   byte 0  fmt(0-1) | fit(2) | ao(3) | noUp(4) | orig(5) | hasW(6) | hasH(7)
 *   byte 1  hasQ(0) | hasTs(1) | hasTe(2) | reserved(3-7)
 *   [varint w] [varint h] [byte q] [varint ts] [varint te]   (present per the bits)
 *   [utf-8 src ...]                                           (rest of buffer)
 */
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
  const fmtIndex = Math.max(0, FORMATS.indexOf(req.fmt));

  const hasQ = req.q !== resolved.defaultQuality;
  const hasTs = req.ts !== resolved.timeToStale;
  const hasTe = req.te !== resolved.timeToEvict;

  let control = fmtIndex & 0b11;
  if (req.fit === 'fill') {
    control |= FIT_FILL;
  }
  if (req.ao) {
    control |= AO;
  }
  if (req.noUp) {
    control |= NO_UP;
  }
  if (req.orig) {
    control |= ORIG;
  }
  if (req.w !== undefined) {
    control |= HAS_W;
  }
  if (req.h !== undefined) {
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
  if (req.w !== undefined) {
    writeVarint(head, req.w);
  }
  if (req.h !== undefined) {
    writeVarint(head, req.h);
  }
  if (hasQ) {
    head.push(req.q & 0xff);
  }
  if (hasTs) {
    writeVarint(head, req.ts);
  }
  if (hasTe) {
    writeVarint(head, req.te);
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

    const fmt = FORMATS[control & 0b11]!;
    const fit: ImageFit = control & FIT_FILL ? 'fill' : 'inside';

    const w = control & HAS_W ? readVarint(buf, cursor) : undefined;
    const h = control & HAS_H ? readVarint(buf, cursor) : undefined;
    const q = control2 & HAS_Q ? buf[cursor.i++]! : resolved.defaultQuality;
    const ts = control2 & HAS_TS ? readVarint(buf, cursor) : resolved.timeToStale;
    const te = control2 & HAS_TE ? readVarint(buf, cursor) : resolved.timeToEvict;

    if (cursor.i > buf.length) {
      return null;
    }
    const src = Buffer.from(buf.buffer, buf.byteOffset + cursor.i, buf.length - cursor.i).toString('utf-8');

    const req: ImageRequest = { src, fit, fmt, q, ao: (control & AO) !== 0, ts, te };
    if (w !== undefined) {
      req.w = w;
    }
    if (h !== undefined) {
      req.h = h;
    }
    if (control & NO_UP) {
      req.noUp = true;
    }
    if (control & ORIG) {
      req.orig = true;
    }
    return req;
  } catch {
    return null;
  }
}
