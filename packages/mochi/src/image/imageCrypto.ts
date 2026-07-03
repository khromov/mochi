/**
 * Authenticated encryption for image URL payloads, via the shared `payloadCrypto`
 * module (AES-256-SIV, keyed by an HMAC-SHA512-derived 64-byte key — see `payloadCrypto`).
 * The request (src + transform params) is encrypted — opaque ciphertext on the
 * wire, not readable JSON — and the cosmetic path filename is bound as additional
 * authenticated data (**AAD**), so altering the visible `/my-image-500x500.webp`
 * part fails the integrity check. The synthetic IV doubles as the authenticator
 * (no separate signature).
 */
import { encryptPayloadBytes, decryptPayloadBytes } from '../payloadCrypto';
import { packImageRequest, unpackImageRequest } from './imageCodec';
import type { ImageRequest, ResolvedImageOptions } from './types';

export function encryptImageRequest(req: ImageRequest, filename: string, compress = true): string {
  return encryptPayloadBytes(packImageRequest(req), { aad: filename, compress });
}

export function decryptImageRequest(token: string, filename: string, resolved: ResolvedImageOptions): ImageRequest | null {
  const buf = decryptPayloadBytes(token, { aad: filename });
  return buf === null ? null : unpackImageRequest(buf, resolved);
}
