/**
 * HMAC-SHA256 signing for image URLs, mirroring `serverIslandCrypto.ts`. The
 * full request payload is signed so an attacker cannot mint a URL for an
 * arbitrary source — the signature is the primary SSRF gate.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMochiConfig } from '../mochiConfig';
import type { ImageRequest } from './types';

/** '~' is not in the base64url alphabet, so it unambiguously marks compressed payloads. */
const COMPRESSED_PREFIX = '~';

function hmac(payloadJson: string): string {
  const { secretKey } = getMochiConfig();
  // Truncate to 128 bits, matching serverIslandCrypto (secure per NIST SP 800-107).
  return createHmac('sha256', secretKey).update(payloadJson).digest().subarray(0, 16).toString('base64url');
}

export function signImageToken(req: ImageRequest): { token: string; sig: string } {
  const json = JSON.stringify(req);
  const sig = hmac(json);

  const uncompressed = Buffer.from(json, 'utf-8').toString('base64url');
  if (json.length >= 64) {
    const compressed = COMPRESSED_PREFIX + Buffer.from(Bun.deflateSync(Buffer.from(json))).toString('base64url');
    if (compressed.length < uncompressed.length) {
      return { token: compressed, sig };
    }
  }
  return { token: uncompressed, sig };
}

export function verifyImageToken(token: string, sig: string): ImageRequest | null {
  let json: string;
  try {
    if (token.startsWith(COMPRESSED_PREFIX)) {
      json = Buffer.from(Bun.inflateSync(Buffer.from(token.slice(1), 'base64url'))).toString('utf-8');
    } else {
      json = Buffer.from(token, 'base64url').toString('utf-8');
    }
  } catch {
    return null;
  }

  const expected = hmac(json);
  if (sig.length !== expected.length) {
    return null;
  }
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  try {
    return JSON.parse(json) as ImageRequest;
  } catch {
    return null;
  }
}
