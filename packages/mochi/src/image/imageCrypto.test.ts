import { afterEach, describe, expect, test } from 'bun:test';
import { encryptImageRequest, decryptImageRequest } from './imageCrypto';
import { encryptPayload } from '../payloadCrypto';
import type { ImageRequest } from './types';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig(): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

function removeConfig(): void {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
}

afterEach(removeConfig);

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/a.png', size: 'thumbnail', ...over };
}

const NAME = 'a-thumbnail.webp';

describe('encryptImageRequest + decryptImageRequest', () => {
  test('round-trips the request', () => {
    installConfig();
    const r = req();
    expect(decryptImageRequest(encryptImageRequest(r, NAME), NAME)).toEqual(r);
  });

  test('token is opaque ciphertext — src not readable', () => {
    installConfig();
    const token = encryptImageRequest(req({ src: 'https://internal.evil/secret' }), NAME);
    expect(Buffer.from(token, 'base64url').toString('utf-8')).not.toContain('internal.evil');
  });

  test('rejects a tampered payload', () => {
    installConfig();
    const token = encryptImageRequest(req(), NAME);
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) + (token[mid] === 'A' ? 'B' : 'A') + token.slice(mid + 1);
    expect(decryptImageRequest(tampered, NAME)).toBeNull();
  });

  test('rejects a tampered filename (AAD mismatch)', () => {
    installConfig();
    const token = encryptImageRequest(req(), NAME);
    expect(decryptImageRequest(token, 'evil-thumbnail.webp')).toBeNull();
  });

  test('round-trips a long src (compressed path)', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    expect(decryptImageRequest(encryptImageRequest(r, NAME), NAME)).toEqual(r);
  });

  test('compress=false skips compression but still round-trips', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    const compressed = encryptImageRequest(r, NAME, true);
    const raw = encryptImageRequest(r, NAME, false);
    expect(raw.length).toBeGreaterThan(compressed.length);
    expect(decryptImageRequest(raw, NAME)).toEqual(r);
  });

  test('round-trips a full-size original request', () => {
    installConfig();
    const r = req({ size: undefined, original: true });
    const name = 'a-original.png';
    expect(decryptImageRequest(encryptImageRequest(r, name), name)).toEqual(r);
  });

  test('round-trips a request with no size and no original flag', () => {
    installConfig();
    const r: ImageRequest = { src: 'https://example.com/a.png' };
    const name = 'a-original.png';
    expect(decryptImageRequest(encryptImageRequest(r, name), name)).toEqual(r);
  });

  test('binary token is shorter than the equivalent JSON-based token', () => {
    installConfig();
    const r = req();
    const token = encryptImageRequest(r, NAME);
    const jsonToken = encryptPayload(JSON.stringify(r), { aad: NAME });
    expect(token.length).toBeLessThan(jsonToken.length);
  });

  test('decrypting an invalid base64url token fails closed', () => {
    installConfig();
    expect(decryptImageRequest('not-a-valid-token!!', NAME)).toBeNull();
  });
});

// The token is deterministic (deterministic IV) under a fixed MOCHI_KEY, so these
// exact-string snapshots pin the wire format. Any accidental change to the codec
// layout, default-omission, compression, or crypto envelope will fail these — at
// which point inspect whether the change is intentional before updating the values.
describe('wire-format snapshots (fixed MOCHI_KEY)', () => {
  test('named size', () => {
    installConfig();
    const r = req();
    expect(encryptImageRequest(r, 'a-thumbnail.webp')).toBe('1Cif5QRpm6sa7sd1UNaHfsbaIdcudT1dn81R-Aj4rk5YcUdsIazCFDHiFieB');
    expect(decryptImageRequest(encryptImageRequest(r, 'a-thumbnail.webp'), 'a-thumbnail.webp')).toEqual(r);
  });

  test('full-size original', () => {
    installConfig();
    const r = req({ size: undefined, original: true });
    expect(encryptImageRequest(r, 'a-original.png')).toBe('FrlLt2knQcdk8lwslO9NN4e-1AbIUK9F1IGfPWKM8mhLQYU');
    expect(decryptImageRequest(encryptImageRequest(r, 'a-original.png'), 'a-original.png')).toEqual(r);
  });

  test('long src exercises the compressed path', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    expect(encryptImageRequest(r, 'a-thumbnail.webp')).toBe('zPoRwsFdhOdcukAKzKxN3MLOzX9yBtew-61DruPu3fDq3kljavqa8XkD2x5w3ehZh6altdglw64olXM94mu1');
    expect(decryptImageRequest(encryptImageRequest(r, 'a-thumbnail.webp'), 'a-thumbnail.webp')).toEqual(r);
  });
});
