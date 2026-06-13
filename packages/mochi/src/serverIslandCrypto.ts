/**
 * HMAC-SHA256 signing for server island props.
 * Props are signed (not encrypted) to prevent tampering.
 *
 * The secret key and compression setting are read from the shared Mochi
 * config (initialized by `Mochi.serve()`).
 *
 * When compression is enabled via `MochiServeOptions.compressServerIslandProps`,
 * payloads ≥ 64 bytes are deflate-compressed if it reduces size. Compressed
 * payloads are prefixed with '~' (not in base64url alphabet).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMochiConfig } from './mochiConfig';

/** '~' is not in the base64url alphabet [A-Za-z0-9_-], so it unambiguously marks compressed payloads. */
const COMPRESSED_PREFIX = '~';

export function signProps(propsJson: string): string {
  const { secretKey, options } = getMochiConfig();
  // Truncate HMAC-SHA256 to 128 bits (16 bytes / 22 base64url chars).
  // 128-bit HMAC is secure per NIST SP 800-107 and saves 21 chars per token.
  const sig = createHmac('sha256', secretKey).update(propsJson).digest().subarray(0, 16).toString('base64url');

  // Try deflate compression for larger payloads
  const compress = options.compressServerIslandProps ?? true;
  if (compress && propsJson.length >= 64) {
    const compressed = Bun.deflateSync(Buffer.from(propsJson));
    const compressedPayload = COMPRESSED_PREFIX + Buffer.from(compressed).toString('base64url');
    const uncompressedPayload = Buffer.from(propsJson, 'utf-8').toString('base64url');
    if (compressedPayload.length < uncompressedPayload.length) {
      return `${compressedPayload}.${sig}`;
    }
  }

  const payload = Buffer.from(propsJson, 'utf-8').toString('base64url');
  return `${payload}.${sig}`;
}

export function verifyAndDecodeProps(token: string): string | null {
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) {
    return null;
  }

  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  let propsJson: string;
  try {
    if (payload.startsWith(COMPRESSED_PREFIX)) {
      // Compressed: ~ + base64url(deflate(json))
      const compressed = Buffer.from(payload.slice(1), 'base64url');
      propsJson = Buffer.from(Bun.inflateSync(compressed)).toString('utf-8');
    } else {
      // Uncompressed: base64url(json)
      propsJson = Buffer.from(payload, 'base64url').toString('utf-8');
    }
  } catch {
    return null;
  }

  const { secretKey } = getMochiConfig();
  // Must match the truncated 128-bit HMAC from signProps
  const expectedSig = createHmac('sha256', secretKey).update(propsJson).digest().subarray(0, 16).toString('base64url');

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) {
    return null;
  }
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  return propsJson;
}
