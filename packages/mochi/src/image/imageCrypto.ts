/**
 * AES-256-GCM encryption for image URL payloads, via the shared `payloadCrypto`
 * module. The request (src + transform params) is encrypted — opaque ciphertext
 * on the wire, not readable JSON — and the cosmetic path filename is bound as
 * GCM **AAD**, so altering the visible `/my-image-500x500.webp` part invalidates
 * the token. GCM's auth tag is the integrity gate (no separate signature).
 */
import { encryptPayloadBytes, decryptPayloadBytes } from '../payloadCrypto';
import { packImageRequest, unpackImageRequest } from './imageCodec';
import type { ImageRequest, ResolvedImageOptions } from './types';

export function encryptImageRequest(req: ImageRequest, filename: string, resolved: ResolvedImageOptions, compress = true): string {
  return encryptPayloadBytes(packImageRequest(req, resolved), { aad: filename, compress });
}

export function decryptImageRequest(token: string, filename: string, resolved: ResolvedImageOptions): ImageRequest | null {
  const buf = decryptPayloadBytes(token, { aad: filename });
  return buf === null ? null : unpackImageRequest(buf, resolved);
}
