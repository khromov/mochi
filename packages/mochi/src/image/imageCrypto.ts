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
import type { ImageRequest } from './types';

// Wire-format version, folded into the AAD. A token minted under a different
// payload layout fails authentication outright (clean 403) instead of
// decrypting successfully and misparsing under the current bit layout — the
// pre-named-sizes format used every control bit, so the codec itself cannot
// distinguish generations. Bump when `imageCodec.ts` changes incompatibly.
const WIRE_VERSION = 'mochi-image-v2';

function versionedAad(filename: string): string {
  return `${WIRE_VERSION}:${filename}`;
}

export function encryptImageRequest(req: ImageRequest, filename: string, compress = true): string {
  return encryptPayloadBytes(packImageRequest(req), { aad: versionedAad(filename), compress });
}

export function decryptImageRequest(token: string, filename: string): ImageRequest | null {
  const buf = decryptPayloadBytes(token, { aad: versionedAad(filename) });
  return buf === null ? null : unpackImageRequest(buf);
}
