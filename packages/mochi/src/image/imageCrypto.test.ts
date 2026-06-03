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
  return {
    src: 'https://example.com/a.png',
    width: 200,
    height: 200,
    fit: 'inside',
    format: 'webp',
    quality: 80,
    autoOrient: true,
    ...over,
  };
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
    const r = req({ original: true });
    const name = 'a-original.png';
    expect(decryptImageRequest(encryptImageRequest(r, name, RESOLVED), name, RESOLVED)).toEqual(r);
  });

  test('binary token is shorter than the equivalent JSON-based token', () => {
    installConfig();
    const r = req({ format: 'jpeg', quality: 60, width: 400, height: 400 });
    const token = encryptImageRequest(r, NAME, RESOLVED);
    const jsonToken = encryptPayload(JSON.stringify(r), { aad: NAME });
    expect(token.length).toBeLessThan(jsonToken.length);
  });
});

// The token is deterministic (deterministic IV) under a fixed MOCHI_KEY, so these
// exact-string snapshots pin the wire format. Any accidental change to the codec
// layout, default-omission, compression, or crypto envelope will fail these — at
// which point inspect whether the change is intentional before updating the values.
describe('wire-format snapshots (fixed MOCHI_KEY)', () => {
  test('resize with all defaults', () => {
    installConfig();
    const r = req();
    expect(encryptImageRequest(r, 'a-200x200.webp', RESOLVED)).toBe('USdP81cqDPXzm-MmhXj0NbhLAGeYGCeukIKFcpxasuai-8gkD7pMcCjIgrlFYh8Jp5nI50HwXSXtGT5sQ5_BmA');
    expect(decryptImageRequest(encryptImageRequest(r, 'a-200x200.webp', RESOLVED), 'a-200x200.webp', RESOLVED)).toEqual(r);
  });

  test('resize with non-default format/quality/fit/withoutEnlargement', () => {
    installConfig();
    const r = req({ width: 400, height: 400, fit: 'fill', format: 'jpeg', quality: 60, withoutEnlargement: true });
    expect(encryptImageRequest(r, 'a-400x400.jpg', RESOLVED)).toBe('TvioQ5sKF0WUjTb7j-HLfCmeHYBKT7uAJMCyJ-gsyFcqCbommzwQv7jak6D1sheVEj_iB_4P9QlNSZ7ne2wKrUo');
    expect(decryptImageRequest(encryptImageRequest(r, 'a-400x400.jpg', RESOLVED), 'a-400x400.jpg', RESOLVED)).toEqual(r);
  });

  test('full-size original', () => {
    installConfig();
    const r = req({ width: undefined, height: undefined, original: true });
    expect(encryptImageRequest(r, 'a-original.png', RESOLVED)).toBe('k2CTNhm9ndH9jj6Po0MoaRUanRiIKowkAQh-_oxYbcb-0KSQKobDUD-dr6n2poJC8699pH0fp8l9dQ');
    expect(decryptImageRequest(encryptImageRequest(r, 'a-original.png', RESOLVED), 'a-original.png', RESOLVED)).toEqual(r);
  });

  test('long src exercises the compressed path', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    expect(encryptImageRequest(r, 'a-200x200.webp', RESOLVED)).toBe(
      '-vbKKXrLyN-X5n8fJKv0h0z21g_y4pVPA80MUo7dD-iU90AWTbWYR4CDTJcsw2WiAxfgKoyVpjVhFl8eVJXQdHXu_V_dJTu1ry4zToPa7zdNsw',
    );
    expect(decryptImageRequest(encryptImageRequest(r, 'a-200x200.webp', RESOLVED), 'a-200x200.webp', RESOLVED)).toEqual(r);
  });
});
