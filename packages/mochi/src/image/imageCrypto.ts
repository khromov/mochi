/**
 * AES-256-GCM encryption for image URL payloads, via the shared `payloadCrypto`
 * module. The request (src + transform params) is encrypted — opaque ciphertext
 * on the wire, not readable JSON — and the cosmetic path filename is bound as
 * GCM **AAD**, so altering the visible `/my-image-500x500.webp` part invalidates
 * the token. GCM's auth tag is the integrity gate (no separate signature).
 */
import { encryptPayload, decryptPayload } from '../payloadCrypto';
import type { ImageRequest } from './types';

export function encryptImageRequest(req: ImageRequest, filename: string, compress = true): string {
  return encryptPayload(JSON.stringify(req), { aad: filename, compress });
}

export function decryptImageRequest(token: string, filename: string): ImageRequest | null {
  const json = decryptPayload(token, { aad: filename });
  if (json === null) {
    return null;
  }
  try {
    return JSON.parse(json) as ImageRequest;
  } catch {
    return null;
  }
}
