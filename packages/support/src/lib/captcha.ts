import { createHash, randomUUID } from 'node:crypto';
import { encryptPayload, decryptPayload } from 'mochi-framework';
import { CAPTCHA_AAD, powInput, leadingZeroBits } from './pow';

const MAX_AGE_MS = 15 * 60_000;

// A generic message for every token failure so probing bots can't distinguish
// "too fast" from "tampered" and learn the timing floor.
const GENERIC_ERROR = 'Verification failed — reload the page and try again.';

// Env reads are lazy (per call) so tests can lower difficulty in beforeAll.
export function powBits(): number {
  return Number(process.env.CAPTCHA_POW_BITS) || 16;
}

export function minAgeMs(): number {
  const raw = Number(process.env.CAPTCHA_MIN_AGE_MS);
  return Number.isFinite(raw) ? raw : 2000;
}

export function mintCaptchaToken(): string {
  return encryptPayload(JSON.stringify({ iat: Date.now(), nonce: randomUUID() }), { aad: CAPTCHA_AAD });
}

export function verifyCaptchaToken(token: string, pow: string): { ok: true; nonce: string; expiresAt: number } | { ok: false; error: string } {
  const opened = token ? decryptPayload(token, { aad: CAPTCHA_AAD }) : null;
  if (opened === null) {
    return { ok: false, error: GENERIC_ERROR };
  }
  let iat: number;
  let nonce: string;
  try {
    const parsed = JSON.parse(opened) as { iat?: unknown; nonce?: unknown };
    if (typeof parsed.iat !== 'number' || typeof parsed.nonce !== 'string') {
      return { ok: false, error: GENERIC_ERROR };
    }
    ({ iat, nonce } = parsed as { iat: number; nonce: string });
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
  const age = Date.now() - iat;
  if (age < minAgeMs() || age > MAX_AGE_MS) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const digest = createHash('sha256').update(powInput(token, pow)).digest();
  if (leadingZeroBits(digest) < powBits()) {
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true, nonce, expiresAt: iat + MAX_AGE_MS };
}
