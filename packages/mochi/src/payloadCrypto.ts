/**
 * Reusable deterministic authenticated encryption for the framework — used to
 * seal server-island props and image-request payloads so they're opaque on the
 * wire (confidentiality) and tamper-proof (integrity).
 *
 * This is an SIV-style (synthetic-IV) construction: a single 16-byte value
 * serves as **both** the encryption nonce and the authenticator, so the envelope
 * carries one value instead of a separate IV *and* MAC tag. That keeps tokens as
 * short as possible (12 bytes shorter than the previous AES-GCM envelope) while
 * remaining misuse-resistant.
 *
 *   siv        = HMAC-SHA256(macKey, aad ‖ inner)[:16]      (authenticator + nonce)
 *   ciphertext = AES-256-CTR(encKey, iv = siv).encrypt(inner)
 *   envelope   = base64url( siv(16) ‖ ciphertext )
 *
 * `encKey`/`macKey` are independent subkeys derived from `getMochiConfig().secretKey`
 * (so any `MOCHI_KEY` length works and the existing secret — and its
 * `serverIsland:secretKey` filter — is reused). The `siv` is a deterministic PRF
 * of `(macKey, aad, inner)`, so identical inputs produce identical ciphertext —
 * which keeps image URLs stable/cacheable; the trade-off is that equal plaintexts
 * are observably equal (acceptable here, and already true under the prior scheme).
 *
 * On decrypt the `siv` recovers the keystream, then the authenticator is
 * recomputed over the recovered `inner` and compared in constant time — any
 * tampering (ciphertext, siv, or aad) fails the comparison. The plaintext sealed
 * inside is `flags(1) ‖ payload`; `flags` bit 0 = payload was deflate-compressed
 * before encryption (so the flags byte is authenticated alongside the payload).
 */
import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { getMochiConfig } from './mochiConfig';

const SIV_LEN = 16;
const FLAG_COMPRESSED = 1;

// Independent CTR-encryption and authentication subkeys derived from the root
// secret via labelled HMACs (a simple KDF: root secret as the HMAC key, a fixed
// label as the message).
function subKeys(): { encKey: Buffer; macKey: Buffer } {
  const root = getMochiConfig().secretKey;
  return {
    encKey: createHmac('sha256', root).update('mochi-payload-siv-enc').digest(),
    macKey: createHmac('sha256', root).update('mochi-payload-siv-mac').digest(),
  };
}

function syntheticIv(macKey: Buffer, aad: string | undefined, inner: Buffer): Buffer {
  return createHmac('sha256', macKey)
    .update(aad ?? '')
    .update(inner)
    .digest()
    .subarray(0, SIV_LEN);
}

export interface EncryptOptions {
  /** Additional authenticated data — bound to the ciphertext but not stored in it. */
  aad?: string;
  /** Deflate payloads ≥ 64 bytes when it shrinks them. Default: true. */
  compress?: boolean;
}

export function encryptPayload(plaintext: string, opts: EncryptOptions = {}): string {
  return encryptPayloadBytes(Buffer.from(plaintext, 'utf-8'), opts);
}

export function encryptPayloadBytes(input: Uint8Array, opts: EncryptOptions = {}): string {
  const { encKey, macKey } = subKeys();

  let payload = Buffer.from(input);
  let flags = 0;
  if ((opts.compress ?? true) && payload.length >= 64) {
    const deflated = Buffer.from(Bun.deflateSync(payload));
    if (deflated.length < payload.length) {
      payload = deflated;
      flags |= FLAG_COMPRESSED;
    }
  }
  // Seal the flags byte alongside the payload so it's authenticated too.
  const inner = Buffer.concat([Buffer.from([flags]), payload]);

  const siv = syntheticIv(macKey, opts.aad, inner);
  const cipher = createCipheriv('aes-256-ctr', encKey, siv);
  const ciphertext = Buffer.concat([cipher.update(inner), cipher.final()]);

  return Buffer.concat([siv, ciphertext]).toString('base64url');
}

export function decryptPayload(token: string, opts: { aad?: string } = {}): string | null {
  const buf = decryptPayloadBytes(token, opts);
  return buf === null ? null : buf.toString('utf-8');
}

export function decryptPayloadBytes(token: string, opts: { aad?: string } = {}): Buffer | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < SIV_LEN + 1) {
      return null; // too short to hold the siv + at least the flags byte
    }
    const { encKey, macKey } = subKeys();
    const siv = buf.subarray(0, SIV_LEN);
    const ciphertext = buf.subarray(SIV_LEN);

    const decipher = createDecipheriv('aes-256-ctr', encKey, siv);
    const inner = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Authenticate: the siv must be the PRF of exactly this (aad, inner).
    const expected = syntheticIv(macKey, opts.aad, inner);
    if (!timingSafeEqual(expected, siv)) {
      return null;
    }

    const flags = inner[0]!;
    let payload = inner.subarray(1);
    if (flags & FLAG_COMPRESSED) {
      payload = Buffer.from(Bun.inflateSync(payload));
    }
    return payload;
  } catch {
    return null;
  }
}
