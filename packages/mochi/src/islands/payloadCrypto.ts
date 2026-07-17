/**
 * Reusable deterministic authenticated encryption for the framework — used to
 * seal server-island props and image-request payloads so they're opaque on the
 * wire (confidentiality) and tamper-proof (integrity).
 *
 * Built on **AES-256-SIV (RFC 5297)** from the audited `@noble/ciphers` library
 * rather than a hand-rolled construction. SIV is nonce-misuse-resistant and
 * deterministic: the 16-byte synthetic IV is `S2V(K1, aad ‖ inner)` and doubles
 * as both the CTR nonce and the authentication tag, so the envelope carries one
 * 16-byte value instead of a separate IV *and* MAC tag — keeping tokens short
 * (12 bytes shorter than the previous AES-GCM envelope).
 *
 *   envelope = base64url( siv(16) ‖ ciphertext )   // aessiv(key, aad).encrypt(inner)
 *
 * The 64-byte AES-256-SIV key (noble splits it: K1 for S2V/CMAC, K2 for CTR) is
 * derived as `HMAC-SHA512(secretKey, label)` from `getMochiConfig().secretKey`,
 * so any `MOCHI_KEY` length works and the existing secret — and its
 * `serverIsland:secretKey` filter — is reused. Because SIV is deterministic,
 * identical `(key, aad, inner)` produce identical ciphertext, which keeps image
 * URLs stable/cacheable; the trade-off is that equal plaintexts are observably
 * equal (acceptable here, and already true under the prior scheme).
 *
 * The `aad` is bound as an S2V associated-data component (the filename for images,
 * the component name for server islands), so a token sealed under one `aad` fails
 * to decrypt under another. The plaintext sealed inside is `flags(1) ‖ payload`;
 * `flags` bit 0 = payload was deflate-compressed before encryption (so the flags
 * byte is authenticated alongside the payload).
 */
import { aessiv } from '@noble/ciphers/aes.js';
import { createHmac } from 'node:crypto';
import { getMochiConfig } from '../mochiConfig';
import { applyFilter } from '../extensions';

const SIV_LEN = 16;
const FLAG_COMPRESSED = 1;

/**
 * Default minimum payload size (bytes) before `encryptPayloadBytes` attempts
 * deflate. Below this, zlib framing outweighs any saving for the two real
 * payload shapes (packed image requests, devalue island props), so the deflate
 * call is wasted — the inner "use only if smaller" check still guards larger
 * low-redundancy payloads. Empirically derived; re-derive with:
 *   bun packages/mochi/scripts/compression-threshold.ts
 *
 * Override per app via the `payload:compressMinBytes` filter.
 */
export const DEFAULT_COMPRESS_MIN_BYTES = 80;

// 64-byte AES-256-SIV key derived from the root secret. SHA-512's 64-byte output
// maps directly to noble's expected key length (split internally into the S2V
// and CTR halves). Memoized per secret — the derivation is a pure function of
// the config's secretKey, and encrypt/decrypt run on every image URL mint and
// every island-props round-trip (the key on secret handles tests reconfiguring).
let cachedSivKey: { secret: Buffer; key: Buffer } | undefined;
function sivKey(): Buffer {
  const secret = getMochiConfig().secretKey;
  if (!cachedSivKey || cachedSivKey.secret !== secret) {
    cachedSivKey = { secret, key: createHmac('sha512', secret).update('mochi-payload-aes-siv-v1').digest() };
  }
  return cachedSivKey.key;
}

export interface EncryptOptions {
  /** Additional authenticated data — bound to the ciphertext but not stored in it. */
  aad?: string;
  /** Deflate payloads ≥ 80 bytes when it shrinks them. Default: true. */
  compress?: boolean;
}

function aadComponents(aad: string | undefined): Uint8Array[] {
  return aad ? [Buffer.from(aad, 'utf-8')] : [];
}

export function encryptPayload(plaintext: string, opts: EncryptOptions = {}): string {
  return encryptPayloadBytes(Buffer.from(plaintext, 'utf-8'), opts);
}

export function encryptPayloadBytes(input: Uint8Array, opts: EncryptOptions = {}): string {
  let payload = Buffer.from(input);
  let flags = 0;
  const minBytes = applyFilter('payload:compressMinBytes', DEFAULT_COMPRESS_MIN_BYTES, { options: getMochiConfig().options, payload });
  if ((opts.compress ?? true) && payload.length >= minBytes) {
    const deflated = Buffer.from(Bun.deflateSync(payload));
    if (deflated.length < payload.length) {
      payload = deflated;
      flags |= FLAG_COMPRESSED;
    }
  }
  // Seal the flags byte alongside the payload so it's authenticated too.
  const inner = Buffer.concat([Buffer.from([flags]), payload]);

  const sealed = aessiv(sivKey(), ...aadComponents(opts.aad)).encrypt(inner);
  return Buffer.from(sealed).toString('base64url');
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
    // Throws on a bad tag (tampered ciphertext, siv, or aad mismatch).
    const inner = Buffer.from(aessiv(sivKey(), ...aadComponents(opts.aad)).decrypt(buf));

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
