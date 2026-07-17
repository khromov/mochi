import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mintCaptcha, verifyCaptcha, consumeCaptcha, solveCaptcha } from './captcha';
import { CAPTCHA_STEPS, chainInput, powInput, leadingZeroBits } from './pow';
import { encryptPayload } from '../islands/payloadCrypto';
import { initExtensions } from '../extensions';
import { mochiEvents } from '../events';
import type { MochiCaptchaVerifyEvent } from '../events';
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
  initExtensions({}); // clear any filters registered by a test
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
    expect(result).toEqual({ ok: false, reason: 'rejected', error: 'Verification failed — reload the page and try again.' });
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

describe('clock-drift allowance', () => {
  const verifyAged = async (ageMs: number, iatOut?: { iat: number }) => {
    const iat = Date.now() - ageMs;
    if (iatOut) {
      iatOut.iat = iat;
    }
    const token = sealToken({ iat });
    return await verifyCaptcha(fields({ captcha_token: token, captcha_pow: powFor(token, 8, true) }));
  };

  test('accepts a token past maxAgeMs but inside the drift allowance', async () => {
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    expect((await verifyAged(10_000)).ok).toBe(true);
  });

  test('rejects a token past maxAgeMs + the drift allowance', async () => {
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    expect((await verifyAged(40_000)).ok).toBe(false);
  });

  test('the nonce outlives the padded window, so a drift-window token still cannot replay', async () => {
    // Regression guard for the coupling between the acceptance bound and the
    // nonce TTL: if expiresAt tracked maxAgeMs alone it would already be in the
    // past here, both stores prune on `expiresAt < now`, and the nonce would be
    // swept straight back out — making the token replayable inside the pad.
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    const out = { iat: 0 };
    const first = await verifyAged(10_000, out);
    expect(first.ok).toBe(true);
    expect(first.ok && first.expiresAt).toBe(out.iat + 1000 + 30_000);
    expect(first.ok && first.expiresAt > Date.now()).toBe(true);
    expect((await verifyAged(10_000, out)).ok).toBe(true); // different nonce, unaffected

    const iat = Date.now() - 10_000;
    const token = sealToken({ iat });
    const solved = fields({ captcha_token: token, captcha_pow: powFor(token, 8, true) });
    expect((await verifyCaptcha(solved)).ok).toBe(true);
    expect(await verifyCaptcha(solved)).toMatchObject({ ok: false, reason: 'replay' });
  });

  test('captcha:driftAllowanceMs narrows the window', async () => {
    initExtensions({ filters: { 'captcha:driftAllowanceMs': () => 0 } });
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    expect((await verifyAged(10_000)).ok).toBe(false);
  });

  test('captcha:driftAllowanceMs receives the resolved maxAgeMs', async () => {
    let seen = -1;
    initExtensions({
      filters: {
        'captcha:driftAllowanceMs': (value, ctx) => {
          seen = ctx.maxAgeMs;
          return value;
        },
      },
    });
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    await verifyAged(500);
    expect(seen).toBe(1000);
  });

  test('rejects a negative drift allowance', () => {
    initExtensions({ filters: { 'captcha:driftAllowanceMs': () => -1 } });
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    expect(() => mintCaptcha()).toThrow(/non-negative/);
  });
});

describe('captcha:minAgeMs', () => {
  test('overrides the configured floor', async () => {
    initExtensions({ filters: { 'captcha:minAgeMs': () => 0 } });
    installConfig({ bits: 8, minAgeMs: 5000 });
    expect((await verifyCaptcha(fields(solveCaptcha(mintCaptcha())))).ok).toBe(true);
  });

  test('can raise the floor to reject a fresh token', async () => {
    initExtensions({ filters: { 'captcha:minAgeMs': () => 5000 } });
    installConfig({ bits: 8, minAgeMs: 0 });
    expect((await verifyCaptcha(fields(solveCaptcha(mintCaptcha())))).ok).toBe(false);
  });

  test('receives the sealed bits and the acceptance bound', async () => {
    let seenBits = -1;
    let seenLimitMs = -1;
    initExtensions({
      filters: {
        'captcha:minAgeMs': (value, ctx) => {
          seenBits = ctx.bits;
          seenLimitMs = ctx.limitMs;
          return value;
        },
      },
    });
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    await verifyCaptcha(fields(solveCaptcha(mintCaptcha())));
    expect({ bits: seenBits, limitMs: seenLimitMs }).toEqual({ bits: 8, limitMs: 31_000 });
  });

  test('throws when the filter returns a floor at or above the acceptance bound', async () => {
    initExtensions({ filters: { 'captcha:minAgeMs': () => 31_000 } });
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    const solved = fields(solveCaptcha(mintCaptcha()));
    await expect(verifyCaptcha(solved)).rejects.toThrow(/every token is rejected/);
  });
});

describe('replay protection', () => {
  test('rejects a replayed token on the second verify', async () => {
    installConfig();
    const solved = solveCaptcha(mintCaptcha());
    expect((await verifyCaptcha(fields(solved))).ok).toBe(true);
    expect(await verifyCaptcha(fields(solved))).toEqual({
      ok: false,
      reason: 'replay',
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

describe('failure reason', () => {
  test('every probe-able failure collapses to rejected', async () => {
    // The counterpart to the `captcha:verify` event tests below: those assert
    // operators get the true cause, this asserts the client never does. If a new
    // reject() reason ever reaches the caller distinctly, this fails.
    installConfig({ bits: 8, minAgeMs: 5000, maxAgeMs: 10_000 });
    const malformed = await verifyCaptcha(fields({ captcha_token: 'nope', captcha_pow: '1' }));
    const tooFast = await verifyCaptcha(fields(solveCaptcha(mintCaptcha())));
    const expired = sealToken({ iat: Date.now() - 60_000 });
    const stale = await verifyCaptcha(fields({ captcha_token: expired, captcha_pow: powFor(expired, 8, true) }));
    const minted = mintCaptcha();
    const badPow = await verifyCaptcha(fields({ captcha_token: minted.token, captcha_pow: powFor(minted.token, 8, false) }));

    for (const result of [malformed, tooFast, stale, badPow]) {
      expect(result).toEqual({ ok: false, reason: 'rejected', error: 'Verification failed — reload the page and try again.' });
    }
  });

  test('replay is distinguishable so callers can swap in their own copy', async () => {
    installConfig();
    const solved = solveCaptcha(mintCaptcha());
    await verifyCaptcha(fields(solved));
    const replayed = await verifyCaptcha(fields(solved));

    expect(replayed.ok).toBe(false);
    if (replayed.ok) {
      return;
    }
    expect(replayed.reason).toBe('replay');
    // The shape an app's action branches on.
    const message = replayed.reason === 'replay' ? 'Already sent — grab a fresh form.' : replayed.error;
    expect(message).toBe('Already sent — grab a fresh form.');
  });
});

describe('captcha:verify event', () => {
  const seen: MochiCaptchaVerifyEvent[] = [];
  const record = (e: MochiCaptchaVerifyEvent) => {
    seen.push(e);
  };

  beforeEach(() => {
    seen.length = 0;
    mochiEvents.on('captcha:verify', record);
  });

  afterEach(() => {
    mochiEvents.off('captcha:verify', record);
  });

  test('reports success with the sealed difficulty', async () => {
    installConfig();
    await verifyCaptcha(fields(solveCaptcha(mintCaptcha())));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ ok: true, reason: 'ok', bits: 8 });
    expect(seen[0]?.ageMs).toBeGreaterThanOrEqual(0);
  });

  // The client only ever sees one generic message; operators need the real cause.
  test('reports the true reason behind the generic client error', async () => {
    installConfig({ bits: 8, minAgeMs: 5000 });
    const tooFast = await verifyCaptcha(fields(solveCaptcha(mintCaptcha())));
    expect(tooFast).toEqual({ ok: false, reason: 'rejected', error: 'Verification failed — reload the page and try again.' });
    expect(seen[0]).toMatchObject({ ok: false, reason: 'too-fast' });
  });

  test('distinguishes malformed, bad-pow and replay', async () => {
    installConfig();
    await verifyCaptcha(fields({ captcha_token: 'nope', captcha_pow: '1' }));
    expect(seen.at(-1)).toMatchObject({ ok: false, reason: 'malformed' });

    const minted = mintCaptcha();
    await verifyCaptcha(fields({ captcha_token: minted.token, captcha_pow: powFor(minted.token, 8, false) }));
    expect(seen.at(-1)).toMatchObject({ ok: false, reason: 'bad-pow', bits: 8 });

    const solved = solveCaptcha(mintCaptcha());
    await verifyCaptcha(fields(solved));
    await verifyCaptcha(fields(solved));
    expect(seen.at(-1)).toMatchObject({ ok: false, reason: 'replay' });
  });

  test('expired tokens report expired', async () => {
    installConfig({ bits: 8, minAgeMs: 0, maxAgeMs: 1000 });
    const token = sealToken({ iat: Date.now() - 60_000 });
    await verifyCaptcha(fields({ captcha_token: token, captcha_pow: powFor(token, 8, true) }));
    expect(seen.at(-1)).toMatchObject({ ok: false, reason: 'expired' });
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
