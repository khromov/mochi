import { afterEach, describe, expect, test } from 'bun:test';
import { encryptPayload, decryptPayload } from './payloadCrypto';
import { initExtensions } from './extensions';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig(secret = 'test-key-for-unit-tests-32bytes!') {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from(secret),
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  initExtensions({}); // clear any filters registered by a test
});

describe('encryptPayload + decryptPayload', () => {
  test('round-trips a short payload', () => {
    installConfig();
    const plaintext = JSON.stringify({ a: 1, b: 'two' });
    expect(decryptPayload(encryptPayload(plaintext))).toBe(plaintext);
  });

  test('round-trips a long payload via the compressed path', () => {
    installConfig();
    const plaintext = 'x'.repeat(500);
    const token = encryptPayload(plaintext);
    expect(token.length).toBeLessThan(plaintext.length); // compression shrank it
    expect(decryptPayload(token)).toBe(plaintext);
  });

  test('the payload:compressMinBytes filter gates deflate and receives the payload', () => {
    installConfig();
    const plaintext = 'x'.repeat(500);

    let seenLength = -1;
    // Raise the threshold above the payload size → deflate skipped → token larger than input.
    initExtensions({
      filters: {
        'payload:compressMinBytes': (def, { payload }) => {
          seenLength = payload.length;
          return 10_000;
        },
      },
    });
    expect(encryptPayload(plaintext).length).toBeGreaterThan(plaintext.length);
    expect(seenLength).toBe(500); // the filter saw the real payload bytes

    // Lower the threshold below it → deflate applied → token shrinks, still round-trips.
    initExtensions({ filters: { 'payload:compressMinBytes': () => 64 } });
    const compressed = encryptPayload(plaintext);
    expect(compressed.length).toBeLessThan(plaintext.length);
    expect(decryptPayload(compressed)).toBe(plaintext);
  });

  test('is deterministic for identical input (stable URLs)', () => {
    installConfig();
    const plaintext = JSON.stringify({ src: 'https://example.com/a.png', w: 200 });
    expect(encryptPayload(plaintext, { aad: 'a.webp' })).toBe(encryptPayload(plaintext, { aad: 'a.webp' }));
  });

  test('payload is not readable plaintext', () => {
    installConfig();
    const token = encryptPayload(JSON.stringify({ src: 'https://secret.internal/x' }));
    expect(Buffer.from(token, 'base64url').toString('utf-8')).not.toContain('secret.internal');
  });

  test('rejects a tampered token', () => {
    installConfig();
    const token = encryptPayload(JSON.stringify({ a: 1 }));
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) + (token[mid] === 'A' ? 'B' : 'A') + token.slice(mid + 1);
    expect(decryptPayload(tampered)).toBeNull();
  });

  test('AAD mismatch fails decryption', () => {
    installConfig();
    const token = encryptPayload('payload', { aad: 'right.webp' });
    expect(decryptPayload(token, { aad: 'right.webp' })).toBe('payload');
    expect(decryptPayload(token, { aad: 'wrong.webp' })).toBeNull();
    expect(decryptPayload(token)).toBeNull(); // missing AAD
  });

  test('wrong key fails decryption', () => {
    installConfig('key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const token = encryptPayload('secret');
    installConfig('key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(decryptPayload(token)).toBeNull();
  });

  test('rejects garbage', () => {
    installConfig();
    expect(decryptPayload('')).toBeNull();
    expect(decryptPayload('!!!!')).toBeNull();
  });
});

// AES-256-SIV is deterministic, so a fixed (secret, aad, plaintext) always seals
// to the same wire bytes. These frozen tokens pin the on-the-wire envelope: if an
// upgrade to @noble/ciphers (or a change to the key derivation, flags byte, or
// compression gate) alters the format, these fail loudly. That matters because
// tokens minted by an old build must still decrypt on a new one — a silent wire
// change would break every in-flight image URL and server-island payload.
//
// If a change here is intentional, regenerate the expected values and confirm the
// break is acceptable; do NOT blindly --update-snapshots. All tokens use the
// installConfig() default secret 'test-key-for-unit-tests-32bytes!'.
describe('wire format is stable (regression guard)', () => {
  const WIRE = {
    short: 'wT9yKd4HhqlJrSos_BXECSURIy1f4X7PUASy0e9goNTHEg',
    aad: 'WBRAPhaUsZ9YWubbt1nlu0MrxX81soiybXqPIfbNLGiDWw1po2tDPtqEmVL-mO9oJuPQ4BqmrTSj9-7m',
    long: 'dQeIP5VTltvuxbMF0O0h0sSeFa5qMXOtaAg',
    empty: 'BG88zLVcSZpJ9EH_vpizzSk',
  };

  test('short JSON payload seals to a stable token', () => {
    installConfig();
    expect(encryptPayload(JSON.stringify({ a: 1, b: 'two' }))).toBe(WIRE.short);
  });

  test('aad-bound payload seals to a stable token', () => {
    installConfig();
    expect(encryptPayload(JSON.stringify({ src: 'https://example.com/a.png', w: 200 }), { aad: 'a.webp' })).toBe(WIRE.aad);
  });

  test('long compressed payload seals to a stable token', () => {
    installConfig();
    expect(encryptPayload('x'.repeat(500))).toBe(WIRE.long);
  });

  test('empty payload seals to a stable token', () => {
    installConfig();
    expect(encryptPayload('')).toBe(WIRE.empty);
  });

  test('each frozen token still round-trips (format is readable, not just stable)', () => {
    installConfig();
    expect(decryptPayload(WIRE.short)).toBe(JSON.stringify({ a: 1, b: 'two' }));
    expect(decryptPayload(WIRE.aad, { aad: 'a.webp' })).toBe(JSON.stringify({ src: 'https://example.com/a.png', w: 200 }));
    expect(decryptPayload(WIRE.long)).toBe('x'.repeat(500));
    expect(decryptPayload(WIRE.empty)).toBe('');
  });
});
