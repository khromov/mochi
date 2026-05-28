import { afterEach, describe, expect, test } from 'bun:test';
import { signImageToken, verifyImageToken } from './imageCrypto';
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

describe('signImageToken + verifyImageToken', () => {
  test('round-trips the request', () => {
    installConfig();
    const r = req();
    const { token, sig } = signImageToken(r);
    expect(verifyImageToken(token, sig)).toEqual(r);
  });

  test('rejects a tampered signature', () => {
    installConfig();
    const { token, sig } = signImageToken(req());
    const tampered = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(verifyImageToken(token, tampered)).toBeNull();
  });

  test('rejects a tampered token (different src, same sig)', () => {
    installConfig();
    const { sig } = signImageToken(req({ src: 'https://example.com/a.png' }));
    const evil = signImageToken(req({ src: 'https://internal.evil/secret' })).token;
    expect(verifyImageToken(evil, sig)).toBeNull();
  });

  test('round-trips a long src via the compressed path', () => {
    installConfig();
    const r = req({ src: 'https://example.com/' + 'segment/'.repeat(40) + 'image.png' });
    const { token, sig } = signImageToken(r);
    expect(token.startsWith('~')).toBe(true);
    expect(verifyImageToken(token, sig)).toEqual(r);
  });
});
