/**
 * HMAC-SHA256 signing for image URLs, mirroring `serverIslandCrypto.ts`. The
 * full request payload is signed so an attacker cannot mint a URL for an
 * arbitrary source — the signature is the primary SSRF gate. The payload rides
 * in the `?payload=` query param; the path filename is cosmetic.
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

// The signature covers both the request JSON and the cosmetic path filename, so
// the visible `/my-image-500x500.webp` part can't be altered without
// invalidating the URL. NUL can't appear in either input, so it's a safe joiner.
function signingInput(json: string, filename: string): string {
  return `${json}\0${filename}`;
}

export function signImageToken(req: ImageRequest, filename: string): { token: string; sig: string } {
  const json = JSON.stringify(req);
  const sig = hmac(signingInput(json, filename));

  const uncompressed = Buffer.from(json, 'utf-8').toString('base64url');
  if (json.length >= 64) {
    const compressed = COMPRESSED_PREFIX + Buffer.from(Bun.deflateSync(Buffer.from(json))).toString('base64url');
    if (compressed.length < uncompressed.length) {
      return { token: compressed, sig };
    }
  }
  return { token: uncompressed, sig };
}

export function verifyImageToken(token: string, sig: string, filename: string): ImageRequest | null {
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

  const expected = hmac(signingInput(json, filename));
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
