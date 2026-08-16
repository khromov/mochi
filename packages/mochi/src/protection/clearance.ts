import { encryptPayload, decryptPayload } from '../islands/payloadCrypto';
import { PROTECTION_AAD } from './config';

/** Seal a clearance token. Its own AAD keeps captcha challenge tokens and clearances mutually unspendable. */
export function mintClearanceToken(bits: number): string {
  return encryptPayload(JSON.stringify({ iat: Date.now(), bits }), { aad: PROTECTION_AAD });
}

export function hasValidClearance(cookieValue: string | undefined, maxAgeMs: number): boolean {
  if (!cookieValue) {
    return false;
  }
  const opened = decryptPayload(cookieValue, { aad: PROTECTION_AAD });
  if (opened === null) {
    return false;
  }
  let iat: unknown;
  try {
    ({ iat } = JSON.parse(opened) as { iat?: unknown });
  } catch {
    return false;
  }
  if (typeof iat !== 'number') {
    return false;
  }
  const ageMs = Date.now() - iat;
  return ageMs >= 0 && ageMs < maxAgeMs;
}
