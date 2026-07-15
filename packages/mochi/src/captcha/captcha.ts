import { createHash, randomUUID } from 'node:crypto';
import { encryptPayload, decryptPayload } from '../payloadCrypto';
import { getCaptchaRuntime } from './config';
import { CAPTCHA_AAD, CAPTCHA_STEPS, chainInput, powInput, leadingZeroBits } from './pow';
import type { CaptchaResult } from './types';

// One message for every token failure, so a probing bot can't distinguish
// "too fast" from "tampered" and binary-search the timing floor.
const GENERIC_ERROR = 'Verification failed — reload the page and try again.';
const REPLAY_ERROR = 'This form was already submitted. Reload the page to try again.';

export interface MintedCaptcha {
  token: string;
  bits: number;
}

/**
 * Mint a single-use captcha challenge. Spread the result onto `<MochiCaptcha />`.
 *
 * `bits` is sealed inside the encrypted token, so {@link verifyCaptcha} always
 * checks the difficulty this token was actually minted at — reconfiguring the
 * server can never silently weaken or break tokens already in flight.
 */
export function mintCaptcha(options?: { bits?: number }): MintedCaptcha {
  const bits = options?.bits ?? getCaptchaRuntime().options.bits;
  const token = encryptPayload(JSON.stringify({ iat: Date.now(), nonce: randomUUID(), bits }), { aad: CAPTCHA_AAD });
  return { token, bits };
}

/**
 * Verify the `captcha_token` / `captcha_pow` fields a `<MochiCaptcha />` adds to
 * the form. Consumes the one-time nonce on success unless `consume: false`, in
 * which case call {@link consumeCaptcha} yourself once the submission is
 * committed.
 */
export async function verifyCaptcha(formData: FormData, options?: { consume?: boolean }): Promise<CaptchaResult> {
  const token = String(formData.get('captcha_token') ?? '');
  const pow = String(formData.get('captcha_pow') ?? '');
  const opened = token ? decryptPayload(token, { aad: CAPTCHA_AAD }) : null;
  if (opened === null) {
    return { ok: false, error: GENERIC_ERROR };
  }

  let iat: number;
  let nonce: string;
  let bits: number;
  try {
    const parsed = JSON.parse(opened) as { iat?: unknown; nonce?: unknown; bits?: unknown };
    if (typeof parsed.iat !== 'number' || typeof parsed.nonce !== 'string' || typeof parsed.bits !== 'number') {
      return { ok: false, error: GENERIC_ERROR };
    }
    ({ iat, nonce, bits } = parsed as { iat: number; nonce: string; bits: number });
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }

  const { options: resolved, store } = getCaptchaRuntime();
  const age = Date.now() - iat;
  if (age < resolved.minAgeMs || age > resolved.maxAgeMs) {
    return { ok: false, error: GENERIC_ERROR };
  }

  // Re-derive the slide-step chain from the raw token: the widget only reaches
  // the final link by actually running the progression, so a PoW over the token
  // itself (skipping the chain) fails here.
  let challenge = token;
  for (let step = 1; step <= CAPTCHA_STEPS; step++) {
    challenge = createHash('sha256').update(chainInput(challenge, step)).digest('hex');
  }
  if (leadingZeroBits(createHash('sha256').update(powInput(challenge, pow)).digest()) < bits) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const expiresAt = iat + resolved.maxAgeMs;
  if (options?.consume !== false && !(await store.consume(nonce, expiresAt))) {
    return { ok: false, error: REPLAY_ERROR };
  }
  return { ok: true, nonce, expiresAt };
}

/**
 * Solve a minted challenge server-side, returning the exact form fields
 * `<MochiCaptcha />` would submit. For testing captcha-protected forms without a
 * browser — lower `bits` in your test server's `captcha` options, since solving
 * at the production default takes real work.
 */
export function solveCaptcha(minted: MintedCaptcha): { captcha_token: string; captcha_pow: string } {
  let challenge = minted.token;
  for (let step = 1; step <= CAPTCHA_STEPS; step++) {
    challenge = createHash('sha256').update(chainInput(challenge, step)).digest('hex');
  }
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
 * Burn a verified captcha's nonce, returning false if it was already spent.
 * Only needed alongside `verifyCaptcha(formData, { consume: false })` — use that
 * pairing when other validation could still reject the submission, so a fixable
 * mistake doesn't cost the visitor their solved captcha.
 */
export async function consumeCaptcha(result: { nonce: string; expiresAt: number }): Promise<boolean> {
  return await getCaptchaRuntime().store.consume(result.nonce, result.expiresAt);
}
