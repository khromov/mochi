import { randomBytes } from 'node:crypto';
import { encryptPayload, decryptPayload } from '../islands/payloadCrypto';
import { bindHashEqual, type ClientBindHashes, type ResolvedBindOptions } from '../runtime/clientBind';
import type { CookieSerializeOptions } from '../runtime/cookies';
import { PROTECTION_AAD } from './config';

/**
 * Skew tolerance between the minting and validating instance, mirroring the captcha's drift allowance: with multiple
 * instances sharing MOCHI_KEY, a clearance minted on a fast clock would otherwise read as from-the-future and re-challenge
 * the visitor on every request routed elsewhere.
 */
export const CLEARANCE_DRIFT_ALLOWANCE_MS = 30_000;

/**
 * Seal a clearance token. Its own AAD keeps captcha challenge tokens and clearances mutually unspendable. The random `n`
 * keeps clearances unique under deterministic AES-SIV, where equal payloads would otherwise yield byte-identical cookies.
 * `iat` is overridable so a re-mint (the family-flip path) preserves the original lifetime instead of extending it.
 */
export function mintClearanceToken(input: { bits: number; iat?: number; bind: ClientBindHashes | null }): string {
  const payload: Record<string, unknown> = { iat: input.iat ?? Date.now(), bits: input.bits, n: randomBytes(9).toString('base64url') };
  if (input.bind) {
    payload.ph = input.bind.ph;
    payload.hh = input.bind.hh;
    payload.f = input.bind.f;
  }
  return encryptPayload(JSON.stringify(payload), { aad: PROTECTION_AAD });
}

export type ClearanceCheck = { ok: false } | { ok: true; familyFlip: boolean; iat: number; bits: number };

/** Attributes shared by the verify endpoint's mint and the gate's family-flip re-mint, so the two can never drift apart. */
export function clearanceCookieOptions(maxAgeSeconds: number, secure: boolean): CookieSerializeOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds, secure };
}

/**
 * `minBits` is the difficulty currently required: a clearance seals the bits it was actually redeemed at, so raising the
 * protection difficulty re-challenges visitors holding cheaper clearances instead of honoring them until expiry. Bind
 * checks likewise run against the *current* config — enabling or widening binding re-challenges unbound clearances.
 */
export function checkClearance(
  cookieValue: string | undefined,
  opts: { maxAgeMs: number; minBits: number; bind: ResolvedBindOptions; current: ClientBindHashes | null },
): ClearanceCheck {
  if (!cookieValue) {
    return { ok: false };
  }
  const opened = decryptPayload(cookieValue, { aad: PROTECTION_AAD });
  if (opened === null) {
    return { ok: false };
  }
  let parsed: { iat?: unknown; bits?: unknown; n?: unknown; ph?: unknown; hh?: unknown; f?: unknown };
  try {
    parsed = JSON.parse(opened) as typeof parsed;
  } catch {
    return { ok: false };
  }
  const { iat, bits } = parsed;
  if (typeof iat !== 'number' || typeof bits !== 'number' || typeof parsed.n !== 'string' || bits < opts.minBits) {
    return { ok: false };
  }
  const ageMs = Date.now() - iat;
  if (ageMs < -CLEARANCE_DRIFT_ALLOWANCE_MS || ageMs >= opts.maxAgeMs) {
    return { ok: false };
  }
  let familyFlip = false;
  if (opts.bind.headers.length > 0) {
    if (!opts.current || typeof parsed.hh !== 'string' || !bindHashEqual(parsed.hh, opts.current.hh)) {
      return { ok: false };
    }
  }
  if (opts.bind.network) {
    if (!opts.current || typeof parsed.ph !== 'string' || typeof parsed.f !== 'number') {
      return { ok: false };
    }
    if (!bindHashEqual(parsed.ph, opts.current.ph)) {
      // Happy Eyeballs: a dual-stack client can solve over IPv4 and return over IPv6. Only
      // that direction is forgiven — the caller re-mints bound to the v6 prefix.
      if (!(parsed.f === 4 && opts.current.f === 6)) {
        return { ok: false };
      }
      familyFlip = true;
    }
  }
  return { ok: true, familyFlip, iat, bits };
}
