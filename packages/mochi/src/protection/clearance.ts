import { encryptPayload, decryptPayload } from '../islands/payloadCrypto';
import { PROTECTION_AAD } from './config';

/**
 * Skew tolerance between the minting and validating instance, mirroring the captcha's drift allowance: with multiple
 * instances sharing MOCHI_KEY, a clearance minted on a fast clock would otherwise read as from-the-future and re-challenge
 * the visitor on every request routed elsewhere.
 */
export const CLEARANCE_DRIFT_ALLOWANCE_MS = 30_000;

/** Seal a clearance token. Its own AAD keeps captcha challenge tokens and clearances mutually unspendable. */
export function mintClearanceToken(bits: number): string {
  return encryptPayload(JSON.stringify({ iat: Date.now(), bits }), { aad: PROTECTION_AAD });
}

/**
 * `minBits` is the difficulty currently required: a clearance seals the bits it was actually redeemed at, so raising the
 * protection difficulty re-challenges visitors holding cheaper clearances instead of honoring them until expiry.
 */
export function hasValidClearance(cookieValue: string | undefined, maxAgeMs: number, minBits: number): boolean {
  if (!cookieValue) {
    return false;
  }
  const opened = decryptPayload(cookieValue, { aad: PROTECTION_AAD });
  if (opened === null) {
    return false;
  }
  let iat: unknown;
  let bits: unknown;
  try {
    ({ iat, bits } = JSON.parse(opened) as { iat?: unknown; bits?: unknown });
  } catch {
    return false;
  }
  if (typeof iat !== 'number' || typeof bits !== 'number' || bits < minBits) {
    return false;
  }
  const ageMs = Date.now() - iat;
  return ageMs >= -CLEARANCE_DRIFT_ALLOWANCE_MS && ageMs < maxAgeMs;
}
