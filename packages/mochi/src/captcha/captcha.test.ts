import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mintCaptcha, verifyCaptcha, consumeCaptcha, solveCaptcha } from './captcha';
import { CAPTCHA_STEPS, chainInput, powInput, leadingZeroBits } from './pow';
import { encryptPayload } from '../payloadCrypto';
import type { MochiCaptchaOptions } from './types';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_RUNTIME_KEY = '__mochi_captcha_runtime__';

// Difficulty is kept low so the tests spend milliseconds, not seconds, hashing.
function installConfig(captcha: MochiCaptchaOptions = { bits: 8, minAgeMs: 0 }) {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: { captcha },
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
});

const fields = (f: Record<string, string>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(f)) {
    fd.set(k, v);
  }
  return fd;
};

/** Seal a token directly so a test can control `iat` / `bits`, which mintCaptcha won't expose. */
const sealToken = (payload: { iat?: number; nonce?: string; bits?: number }): string =>
  encryptPayload(JSON.stringify({ iat: Date.now(), nonce: crypto.randomUUID(), bits: 8, ...payload }), { aad: 'mochi-captcha' });

const powFor = (token: string, bits: number, passing: boolean): string => {
  let challenge = token;
  for (let step = 1; step <= CAPTCHA_STEPS; step++) {
    challenge = createHash('sha256').update(chainInput(challenge, step)).digest('hex');
  }
  for (let n = 0; ; n++) {
    if (
      leadingZeroBits(
        createHash('sha256')
          .update(powInput(challenge, String(n)))
          .digest(),
      ) >=
        bits ===
      passing
    ) {
      return String(n);
    }
  }
};

describe('mintCaptcha + verifyCaptcha', () => {
  test('accepts a solved challenge', async () => {
    installConfig();
    const result = await verifyCaptcha(fields(solveCaptcha(mintCaptcha())));
    expect(result.ok).toBe(true);
  });

  test('mints with the configured difficulty by default', () => {
    installConfig({ bits: 12, minAgeMs: 0 });
    expect(mintCaptcha().bits).toBe(12);
  });

  test('rejects a tampered token', async () => {
    installConfig();
    const solved = solveCaptcha(mintCaptcha());
    const result = await verifyCaptcha(fields({ ...solved, captcha_token: `${solved.captcha_token}x` }));
    expect(result).toEqual({ ok: false, error: 'Verification failed — reload the page and try again.' });
  });

  test('rejects an absent token', async () => {
    installConfig();
    expect((await verifyCaptcha(fields({}))).ok).toBe(false);
  });

  test('rejects a proof-of-work below the difficulty target', async () => {
    installConfig();
    const minted = mintCaptcha();
    const result = await verifyCaptcha(fields({ captcha_token: minted.token, captcha_pow: powFor(minted.token, 8, false) }));
    expect(result.ok).toBe(false);
  });

  test('rejects a proof-of-work over the raw token that skips the step chain', async () => {
    installConfig();
    const minted = mintCaptcha();
    // Solve against the token itself rather than the chain's final link — what a
    // bot that read the token out of the HTML but never ran the slide would send.
    const rawPow = (() => {
      for (let n = 0; ; n++) {
        if (
          leadingZeroBits(
            createHash('sha256')
              .update(powInput(minted.token, String(n)))
              .digest(),
          ) >= 8
        ) {
          return String(n);
        }
      }
    })();
    expect((await verifyCaptcha(fields({ captcha_token: minted.token, captcha_pow: rawPow }))).ok).toBe(false);
  });

  test('rejects a token younger than the age floor', async () => {
    installConfig({ bits: 8, minAgeMs: 5000 });
    const minted = mintCaptcha();
    expect((await verifyCaptcha(fields(solveCaptcha(minted)))).ok).toBe(false);
  });

  test('rejects an expired token', async () => {
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    const token = sealToken({ iat: Date.now() - 60_000 });
    expect((await verifyCaptcha(fields({ captcha_token: token, captcha_pow: powFor(token, 8, true) }))).ok).toBe(false);
  });

  test('rejects a payload missing the sealed bits', async () => {
    installConfig();
    const token = encryptPayload(JSON.stringify({ iat: Date.now(), nonce: crypto.randomUUID() }), { aad: 'mochi-captcha' });
    expect((await verifyCaptcha(fields({ captcha_token: token, captcha_pow: powFor(token, 8, true) }))).ok).toBe(false);
  });

  test('verifies at the difficulty sealed in the token, not the current config', async () => {
    // A token minted at 4 bits stays verifiable at 4 bits after the server is
    // reconfigured to 20 — difficulty can't drift out from under a live token.
    installConfig({ bits: 4, minAgeMs: 0 });
    const minted = mintCaptcha();
    const solved = solveCaptcha(minted);
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
    installConfig({ bits: 20, minAgeMs: 0 });

    expect(minted.bits).toBe(4);
    expect((await verifyCaptcha(fields(solved))).ok).toBe(true);
  });
});

describe('replay protection', () => {
  test('rejects a replayed token on the second verify', async () => {
    installConfig();
    const solved = solveCaptcha(mintCaptcha());
    expect((await verifyCaptcha(fields(solved))).ok).toBe(true);
    expect(await verifyCaptcha(fields(solved))).toEqual({
      ok: false,
      error: 'This form was already submitted. Reload the page to try again.',
    });
  });

  test('consume: false leaves the nonce spendable', async () => {
    installConfig();
    const solved = solveCaptcha(mintCaptcha());
    expect((await verifyCaptcha(fields(solved), { consume: false })).ok).toBe(true);
    expect((await verifyCaptcha(fields(solved), { consume: false })).ok).toBe(true);
  });

  test('consumeCaptcha burns a deferred nonce exactly once', async () => {
    installConfig();
    const result = await verifyCaptcha(fields(solveCaptcha(mintCaptcha())), { consume: false });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(await consumeCaptcha(result)).toBe(true);
    expect(await consumeCaptcha(result)).toBe(false);
  });

  test('uses a custom store', async () => {
    const seen: string[] = [];
    installConfig({
      bits: 8,
      minAgeMs: 0,
      store: {
        consume: (nonce) => {
          seen.push(nonce);
          return Promise.resolve(true);
        },
      },
    });
    expect((await verifyCaptcha(fields(solveCaptcha(mintCaptcha())))).ok).toBe(true);
    expect(seen).toHaveLength(1);
  });
});

describe('resolveCaptchaOptions', () => {
  test('rejects a bits value outside the supported range', () => {
    installConfig({ bits: 64 });
    expect(() => mintCaptcha()).toThrow(/bits must be an integer between 1 and 32/);
  });

  test('rejects an age floor that exceeds the expiry', () => {
    installConfig({ minAgeMs: 5000, maxAgeMs: 1000 });
    expect(() => mintCaptcha()).toThrow(/must be less than maxAgeMs/);
  });
});
