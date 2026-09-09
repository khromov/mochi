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
 * How long after minting a clearance may be presented from the *other* address family. Happy Eyeballs can send the
 * verify POST and the reload that follows it down different families, so the clearance is minted on one and first
 * presented on the other; the gate then re-mints it against the presenting prefix. Forgiving that for the whole
 * lifetime would reduce network binding to "any address of the other family" for anyone holding a leaked cookie, so
 * the allowance covers only the post-verification reload, padded by the same drift the age check tolerates.
 */
export const CLEARANCE_FAMILY_FLIP_GRACE_MS = 60_000 + CLEARANCE_DRIFT_ALLOWANCE_MS;

/**
 * Seal a clearance token. Its own AAD keeps captcha challenge tokens and clearances mutually unspendable. The random `n`
 * keeps clearances unique under deterministic AES-SIV, where equal payloads would otherwise yield byte-identical cookies.
 * `iat` is overridable so a re-mint (the family-flip path) preserves the original lifetime instead of extending it —
 * and, since the flip allowance is measured from `iat`, so that re-minting can never widen the window it rides on.
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
      // Only a family change is forgiven, and only while the clearance is fresh enough to be the reload that
      // follows verification — a same-family prefix change, or a late flip, is a different network either way.
      const flipped = parsed.f !== 0 && opts.current.f !== 0 && parsed.f !== opts.current.f;
      if (!flipped || ageMs > CLEARANCE_FAMILY_FLIP_GRACE_MS) {
        return { ok: false };
      }
      familyFlip = true;
    }
  }
  return { ok: true, familyFlip, iat, bits };
}
