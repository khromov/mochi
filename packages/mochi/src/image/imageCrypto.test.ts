import { afterEach, describe, expect, test } from 'bun:test';
import { encryptImageRequest, decryptImageRequest } from './imageCrypto';
import type { ImageRequest } from './types';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig() {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

function removeConfig() {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
}

afterEach(removeConfig);

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/a.png', w: 200, h: 200, fit: 'inside', fmt: 'webp', q: 80, ao: true, ts: 60_000, te: 86_400_000, ...over };
}

const NAME = 'a-200x200.webp';

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
    expect(decryptImageRequest(token, 'evil-200x200.webp')).toBeNull();
  });

  test('round-trips a long src (compressed path)', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    expect(decryptImageRequest(encryptImageRequest(r, NAME), NAME)).toEqual(r);
  });

  test('round-trips a full-size original request', () => {
    installConfig();
    const r = req({ orig: true });
    const name = 'a-original.png';
    expect(decryptImageRequest(encryptImageRequest(r, name), name)).toEqual(r);
  });
});
