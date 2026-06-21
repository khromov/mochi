/**
 * HMAC-SHA256 signing for server island props.
 * Props are signed (not encrypted) to prevent tampering.
 *
 * The secret key and compression setting are read from the shared Mochi
 * config (initialized by `Mochi.serve()`).
 *
 * Props are serialized with msgpackr (see `serverIslandSerialize.ts`) — the
 * sign/verify pair takes and returns the prop *value* directly; the HMAC,
 * deflate, and base64url layers operate on the packed bytes. When compression
 * is enabled via `MochiServeOptions.compressServerIslandProps`, payloads
 * ≥ 64 bytes are deflate-compressed if it reduces size. Compressed payloads
 * are prefixed with '~' (not in the base64url alphabet).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMochiConfig } from './mochiConfig';
import { packServerIslandProps, unpackServerIslandProps } from './serverIslandSerialize';

/** '~' is not in the base64url alphabet [A-Za-z0-9_-], so it unambiguously marks compressed payloads. */
const COMPRESSED_PREFIX = '~';

export function signProps(value: unknown): string {
  const { secretKey, options } = getMochiConfig();
  // Copy out of msgpackr's reused internal buffer before any further packing.
  const bytes = Buffer.from(packServerIslandProps(value));
  // Truncate HMAC-SHA256 to 128 bits (16 bytes / 22 base64url chars).
  // 128-bit HMAC is secure per NIST SP 800-107 and saves 21 chars per token.
  // Signed over the uncompressed bytes, matching `verifyAndDecodeProps`.
  const sig = createHmac('sha256', secretKey).update(bytes).digest().subarray(0, 16).toString('base64url');

  // Try deflate compression for larger payloads
  const compress = options.compressServerIslandProps ?? true;
  if (compress && bytes.length >= 64) {
    const compressed = Bun.deflateSync(bytes);
    const compressedPayload = COMPRESSED_PREFIX + Buffer.from(compressed).toString('base64url');
    const uncompressedPayload = bytes.toString('base64url');
    if (compressedPayload.length < uncompressedPayload.length) {
      return `${compressedPayload}.${sig}`;
    }
  }

  return `${bytes.toString('base64url')}.${sig}`;
}

export function verifyAndDecodeProps(token: string): unknown | null {
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) {
    return null;
  }

  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  let bytes: Buffer;
  try {
    if (payload.startsWith(COMPRESSED_PREFIX)) {
      // Compressed: ~ + base64url(deflate(packed))
      bytes = Buffer.from(Bun.inflateSync(Buffer.from(payload.slice(1), 'base64url')));
    } else {
      // Uncompressed: base64url(packed)
      bytes = Buffer.from(payload, 'base64url');
    }
  } catch {
    return null;
  }

  const { secretKey } = getMochiConfig();
  // Must match the truncated 128-bit HMAC from signProps
  const expectedSig = createHmac('sha256', secretKey).update(bytes).digest().subarray(0, 16).toString('base64url');

  // Constant-time comparison to prevent timing attacks. Verify BEFORE unpacking
  // so untrusted bytes are never handed to the deserializer.
  if (sig.length !== expectedSig.length) {
    return null;
  }
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    return unpackServerIslandProps(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
