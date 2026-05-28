import { afterEach, describe, expect, test } from 'bun:test';
import { encryptPayload, decryptPayload } from './payloadCrypto';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig(secret = 'test-key-for-unit-tests-32bytes!') {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from(secret),
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
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
