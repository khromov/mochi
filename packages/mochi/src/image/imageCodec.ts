/**
 * Compact binary encoding for the image-request payload that travels (encrypted)
 * in the `?p=` query param. The payload carries only the source URL and the name
 * of a server-declared size — never the transform config, which lives in
 * `Mochi.serve({ image: { sizes } })`. Keeping the name (not the config) on
 * the wire makes tokens tiny and lets a size redefinition re-render existing
 * URLs (the endpoint re-resolves the name against the current config).
 *
 * Layout (before encryption):
 *   byte 0  original(0) | hasSize(1) | reserved(2-7)
 *   [varint sizeNameByteLength] [utf-8 size name]   (present when hasSize)
 *   [utf-8 src ...]                                          (rest of buffer)
 */
import type { ImageRequest } from './types';

const ORIGINAL = 1 << 0;
const HAS_SIZE = 1 << 1;

function writeVarint(out: number[], value: number): void {
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

export function packImageRequest(req: ImageRequest): Uint8Array {
  const nameBytes = req.size !== undefined ? Buffer.from(req.size, 'utf-8') : undefined;

  let control = 0;
  if (req.original) {
    control |= ORIGINAL;
  }
  if (nameBytes) {
    control |= HAS_SIZE;
  }

  const head: number[] = [control];
  if (nameBytes) {
    writeVarint(head, nameBytes.length);
    for (const b of nameBytes) {
      head.push(b);
    }
  }

  const src = Buffer.from(req.src, 'utf-8');
  const out = new Uint8Array(head.length + src.length);
  out.set(head, 0);
  out.set(src, head.length);
  return out;
}

export function unpackImageRequest(buf: Uint8Array): ImageRequest | null {
  try {
    if (buf.length < 1) {
      return null;
    }
    const control = buf[0]!;
    const cursor = { i: 1 };

    let size: string | undefined;
    if (control & HAS_SIZE) {
      const nameLen = readVarint(buf, cursor);
      if (cursor.i + nameLen > buf.length) {
        return null;
      }
      size = Buffer.from(buf.buffer, buf.byteOffset + cursor.i, nameLen).toString('utf-8');
      cursor.i += nameLen;
    }

    const src = Buffer.from(buf.buffer, buf.byteOffset + cursor.i, buf.length - cursor.i).toString('utf-8');

    const req: ImageRequest = { src };
    if (size !== undefined) {
      req.size = size;
    }
    if (control & ORIGINAL) {
      req.original = true;
    }
    return req;
  } catch {
    return null;
  }
}
