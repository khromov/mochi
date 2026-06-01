import { afterEach, describe, expect, test } from 'bun:test';
import { encryptImageRequest, decryptImageRequest } from './imageCrypto';
import { resolveImageOptions } from './config';
import { encryptPayload } from '../payloadCrypto';
import type { ImageRequest } from './types';

const RESOLVED = resolveImageOptions({});

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
    expect(decryptImageRequest(encryptImageRequest(r, NAME, RESOLVED), NAME, RESOLVED)).toEqual(r);
  });

  test('token is opaque ciphertext — src not readable', () => {
    installConfig();
    const token = encryptImageRequest(req({ src: 'https://internal.evil/secret' }), NAME, RESOLVED);
    expect(Buffer.from(token, 'base64url').toString('utf-8')).not.toContain('internal.evil');
  });

  test('rejects a tampered payload', () => {
    installConfig();
    const token = encryptImageRequest(req(), NAME, RESOLVED);
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) + (token[mid] === 'A' ? 'B' : 'A') + token.slice(mid + 1);
    expect(decryptImageRequest(tampered, NAME, RESOLVED)).toBeNull();
  });

  test('rejects a tampered filename (AAD mismatch)', () => {
    installConfig();
    const token = encryptImageRequest(req(), NAME, RESOLVED);
    expect(decryptImageRequest(token, 'evil-200x200.webp', RESOLVED)).toBeNull();
  });

  test('round-trips a long src (compressed path)', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    expect(decryptImageRequest(encryptImageRequest(r, NAME, RESOLVED), NAME, RESOLVED)).toEqual(r);
  });

  test('compress=false skips compression but still round-trips', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    const compressed = encryptImageRequest(r, NAME, RESOLVED, true);
    const raw = encryptImageRequest(r, NAME, RESOLVED, false);
    expect(raw.length).toBeGreaterThan(compressed.length);
    expect(decryptImageRequest(raw, NAME, RESOLVED)).toEqual(r);
  });

  test('round-trips a full-size original request', () => {
    installConfig();
    const r = req({ orig: true });
    const name = 'a-original.png';
    expect(decryptImageRequest(encryptImageRequest(r, name, RESOLVED), name, RESOLVED)).toEqual(r);
  });

  test('binary token is shorter than the equivalent JSON-based token', () => {
    installConfig();
    const r = req({ fmt: 'jpeg', q: 60, w: 400, h: 400 });
    const token = encryptImageRequest(r, NAME, RESOLVED);
    // Reproduce the old scheme: JSON.stringify → same envelope (compression on).
    const jsonToken = encryptPayload(JSON.stringify(r), { aad: NAME });
    expect(token.length).toBeLessThan(jsonToken.length);
  });
});
