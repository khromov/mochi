import { createHash, randomUUID } from 'node:crypto';
import { encryptPayload, decryptPayload } from '../islands/payloadCrypto';
import { applyFilter } from '../extensions';
import { mochiEvents } from '../events';
import type { MochiCaptchaReason } from '../events';
import { getCaptchaRuntime } from './config';
import { CAPTCHA_AAD, deriveChain, powInput, leadingZeroBits } from './pow';
import type { CaptchaResult, NonceStore } from './types';

// The chain and proof-of-work are re-derived here with node:crypto while the widget uses the sync JS implementation in
// pow.ts. Keeping the two independent lets pow.test.ts assert they agree, checking the JS digest against a known-good
// one on every run rather than against itself.
const nodeHashHex = (input: string) => createHash('sha256').update(input).digest('hex');

// One message for every token failure, so a probing bot can't distinguish
// "too fast" from "tampered" and binary-search the timing floor. The real
// reason still reaches operators through the `captcha:verify` event.
const GENERIC_ERROR = 'Verification failed — reload the page and try again.';
const REPLAY_ERROR = 'This form was already submitted. Reload the page to try again.';

function reject(reason: MochiCaptchaReason, details?: { bits?: number; ageMs?: number }): CaptchaResult {
  mochiEvents.emit('captcha:verify', { ok: false, reason, ...details });
  // The narrowing to 'rejected' happens here rather than at the call site: it is
  // what keeps the probing surface closed, so no future reject() caller can
  // widen it by accident.
  return reason === 'replay' ? { ok: false, reason: 'replay', error: REPLAY_ERROR } : { ok: false, reason: 'rejected', error: GENERIC_ERROR };
}

export interface MintedCaptcha {
  token: string;
  bits: number;
  /** Active solve time the widget spends before giving up. It rides alongside the token rather than sealed inside, since nothing verifies against it and rewriting it only changes how long that visitor's own device tries. */
  solveBudgetMs: number;
}

/**
 * Mint a single-use captcha challenge. Spread the result onto `<MochiCaptcha />`.
 *
 * `bits` is sealed inside the encrypted token, so {@link verifyCaptcha} always
 * checks the difficulty this token was actually minted at — reconfiguring the
 * server can never silently weaken or break tokens already in flight.
 */
export function mintCaptcha(options?: { bits?: number; solveBudgetMs?: number }): MintedCaptcha {
  const resolved = getCaptchaRuntime().options;
  const bits = options?.bits ?? resolved.bits;
  const solveBudgetMs = options?.solveBudgetMs ?? resolved.solveBudgetMs;
  if (!Number.isFinite(solveBudgetMs) || solveBudgetMs <= 0) {
    throw new Error(`Captcha: solveBudgetMs must be a positive finite number, got ${solveBudgetMs}`);
  }
  const token = encryptPayload(JSON.stringify({ iat: Date.now(), nonce: randomUUID(), bits }), { aad: CAPTCHA_AAD });
  return { token, bits, solveBudgetMs };
}

/**
 * Verify the `captcha_token` / `captcha_pow` fields `<MochiCaptcha />` adds to the form, consuming the one-time nonce on
 * success unless `consume: false`, where you call {@link consumeCaptcha} once the submission is committed. A failure
 * carries a ready-to-render `error` plus a `reason` for your own copy — see {@link CaptchaFailureReason} for why
 * `reason` is deliberately coarse. `minAgeMs` overrides the configured timing floor for this call alone — for flows with
 * nothing to fill in (protection mode's auto-solve submits the instant the proof-of-work lands); being explicit and
 * per-call, it also bypasses the app-wide `captcha:minAgeMs` filter. `minBits` refuses tokens minted below a difficulty
 * floor — without it, any endpoint minting easier tokens (a low-bits form captcha) devalues a harder one's proof.
 */
function parseCaptchaClaims(opened: string): { iat: number; nonce: string; bits: number } | null {
  try {
    const parsed = JSON.parse(opened) as { iat?: unknown; nonce?: unknown; bits?: unknown };
    if (typeof parsed.iat !== 'number' || typeof parsed.nonce !== 'string' || typeof parsed.bits !== 'number') {
      return null;
    }
    return { iat: parsed.iat, nonce: parsed.nonce, bits: parsed.bits };
  } catch {
    return null;
  }
}

// Re-derive the slide-step chain from the raw token: the widget only reaches the final link by actually running the
// progression, so a PoW over the token itself (skipping the chain) fails here.
function captchaPowSatisfies(token: string, pow: string, bits: number): boolean {
  const challenge = deriveChain(token, nodeHashHex);
  return leadingZeroBits(createHash('sha256').update(powInput(challenge, pow)).digest()) >= bits;
}

async function captchaReplayRejected(store: NonceStore, consume: boolean | undefined, nonce: string, expiresAt: number): Promise<boolean> {
  return consume !== false && !(await store.consume(nonce, expiresAt));
}

function resolveCaptchaMinAgeMs(override: number | undefined, resolvedMin: number, limitMs: number, bits: number, ageMs: number): number {
  const minAgeMs = override ?? applyFilter('captcha:minAgeMs', resolvedMin, { bits, ageMs, limitMs });
  if (!Number.isFinite(minAgeMs) || minAgeMs < 0 || minAgeMs >= limitMs) {
    throw new Error(`Captcha: the captcha:minAgeMs filter returned ${minAgeMs}; expected a non-negative number below ${limitMs}, or every token is rejected`);
  }
  return minAgeMs;
}

export async function verifyCaptcha(formData: FormData, options?: { consume?: boolean; minAgeMs?: number; minBits?: number }): Promise<CaptchaResult> {
  const token = String(formData.get('captcha_token') ?? '');
  const pow = String(formData.get('captcha_pow') ?? '');
  const opened = token ? decryptPayload(token, { aad: CAPTCHA_AAD }) : null;
  if (opened === null) {
    return reject('malformed');
  }

  const claims = parseCaptchaClaims(opened);
  if (claims === null) {
    return reject('malformed');
  }
  const { iat, nonce, bits } = claims;

  if (options?.minBits !== undefined && bits < options.minBits) {
    return reject('bad-pow', { bits });
  }

  const { options: resolved, store } = getCaptchaRuntime();
  const ageMs = Date.now() - iat;

  // Skew between the minting and verifying instance lands directly in `ageMs`, since the two `Date.now()` reads come off
  // different machines, so the allowance widens the expiry bound alone. Padding the floor would mean subtracting from
  // it, and any allowance wider than `minAgeMs` would delete the too-fast check rather than soften it.
  const limitMs = resolved.maxAgeMs + resolved.driftAllowanceMs;
  const minAgeMs = resolveCaptchaMinAgeMs(options?.minAgeMs, resolved.minAgeMs, limitMs, bits, ageMs);

  if (ageMs < minAgeMs) {
    return reject('too-fast', { bits, ageMs });
  }
  if (ageMs > limitMs) {
    return reject('expired', { bits, ageMs });
  }

  if (!captchaPowSatisfies(token, pow, bits)) {
    return reject('bad-pow', { bits, ageMs });
  }

  // Tracks the acceptance bound rather than `maxAgeMs`: a token accepted inside the drift pad would otherwise carry an
  // already-past expiry, and both stores prune on `expiresAt < now`, sweeping the nonce back out so the token replays.
  const expiresAt = iat + limitMs;
  if (await captchaReplayRejected(store, options?.consume, nonce, expiresAt)) {
    return reject('replay', { bits, ageMs });
  }
  mochiEvents.emit('captcha:verify', { ok: true, reason: 'ok', bits, ageMs });
  return { ok: true, nonce, expiresAt };
}

/**
 * Solve a minted challenge server-side, returning the exact form fields `<MochiCaptcha />` would submit, for testing
 * captcha-protected forms without a browser. Lower `bits` in your test server's `captcha` options, since solving at the
 * production default takes real work.
 */
export function solveCaptcha(minted: MintedCaptcha): { captcha_token: string; captcha_pow: string } {
  const challenge = deriveChain(minted.token, nodeHashHex);
  for (let n = 0; ; n++) {
    if (
      leadingZeroBits(
        createHash('sha256')
          .update(powInput(challenge, String(n)))
          .digest(),
      ) >= minted.bits
    ) {
      return { captcha_token: minted.token, captcha_pow: String(n) };
    }
  }
}

/**
 * Burn a verified captcha's nonce, returning false if it was already spent. Needed only alongside
 * `verifyCaptcha(formData, { consume: false })`, the pairing to reach for when other validation could still reject the
 * submission, so a fixable mistake doesn't cost the visitor their solved captcha.
 */
export async function consumeCaptcha(result: { nonce: string; expiresAt: number }): Promise<boolean> {
  return await getCaptchaRuntime().store.consume(result.nonce, result.expiresAt);
}
