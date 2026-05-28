/**
 * Reusable AES-256-GCM payload encryption for the framework — used to seal
 * server-island props and image-request payloads so they're opaque on the wire
 * (confidentiality), with GCM's auth tag providing integrity (replacing the old
 * HMAC signing).
 *
 * The AES-256 key is derived as `sha256(getMochiConfig().secretKey)` so any
 * `MOCHI_KEY` length works and the existing secret (and its `serverIsland:secretKey`
 * filter) is reused without being mutated.
 *
 * The IV is **deterministic** — `HMAC-SHA256(key, aad ‖ data)[:12]` — so identical
 * inputs produce identical ciphertext. That keeps image URLs stable/cacheable;
 * the trade-off is that equal plaintexts are observably equal (acceptable here,
 * and already true under the previous signing scheme).
 *
 * Envelope: `base64url( iv(12) ‖ tag(16) ‖ ciphertext )`, where the plaintext
 * sealed inside is `flags(1) ‖ payload` so the flags byte is authenticated too
 * (tampering any byte but a benign IV change fails the GCM tag).
 * `flags` bit 0 = payload was deflate-compressed before encryption.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto';
import { getMochiConfig } from './mochiConfig';

const IV_LEN = 12;
const TAG_LEN = 16;
const FLAG_COMPRESSED = 1;

function aesKey(): Buffer {
  return createHash('sha256').update(getMochiConfig().secretKey).digest();
}

export interface EncryptOptions {
  /** Additional authenticated data — bound to the ciphertext but not stored in it. */
  aad?: string;
  /** Deflate payloads ≥ 64 bytes when it shrinks them. Default: true. */
  compress?: boolean;
}

export function encryptPayload(plaintext: string, opts: EncryptOptions = {}): string {
  const key = aesKey();

  let payload = Buffer.from(plaintext, 'utf-8');
  let flags = 0;
  if ((opts.compress ?? true) && payload.length >= 64) {
    const deflated = Buffer.from(Bun.deflateSync(payload));
    if (deflated.length < payload.length) {
      payload = deflated;
      flags |= FLAG_COMPRESSED;
    }
  }
  // Seal the flags byte alongside the payload so it's authenticated by GCM.
  const inner = Buffer.concat([Buffer.from([flags]), payload]);

  // Deterministic IV derived from the (aad, inner) being sealed.
  const iv = createHmac('sha256', key)
    .update(opts.aad ?? '')
    .update(inner)
    .digest()
    .subarray(0, IV_LEN);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (opts.aad) {
    cipher.setAAD(Buffer.from(opts.aad, 'utf-8'));
  }
  const ciphertext = Buffer.concat([cipher.update(inner), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptPayload(token: string, opts: { aad?: string } = {}): string | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < IV_LEN + TAG_LEN + 1) {
      return null;
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

    const decipher = createDecipheriv('aes-256-gcm', aesKey(), iv);
    if (opts.aad) {
      decipher.setAAD(Buffer.from(opts.aad, 'utf-8'));
    }
    decipher.setAuthTag(tag);

    const inner = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const flags = inner[0]!;
    let payload = inner.subarray(1);
    if (flags & FLAG_COMPRESSED) {
      payload = Buffer.from(Bun.inflateSync(payload));
    }
    return payload.toString('utf-8');
  } catch {
    return null;
  }
}
