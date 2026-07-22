import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { CAPTCHA_STEPS, chainInput, powInput, leadingZeroBits, toHex, sha256Bytes, sha256Hex, sha256LeadingZeroBits, deriveChain, solvePowSlice } from './pow';

const nodeHex = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

describe('leadingZeroBits', () => {
  test('counts a partial first byte', () => {
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x7f]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
  });

  test('carries across whole zero bytes', () => {
    expect(leadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x01]))).toBe(15);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x80]))).toBe(16);
  });

  test('counts every bit of an all-zero digest', () => {
    expect(leadingZeroBits(new Uint8Array(4))).toBe(32);
    expect(leadingZeroBits(new Uint8Array(0))).toBe(0);
  });
});

describe('toHex', () => {
  test('pads each byte to two lowercase digits', () => {
    expect(toHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff');
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  test("matches node:crypto's digest('hex')", () => {
    const digest = createHash('sha256').update('mochi').digest();
    expect(toHex(new Uint8Array(digest))).toBe(digest.toString('hex'));
  });
});

describe('chain + pow inputs', () => {
  test('are stable and distinct per step', () => {
    expect(chainInput('abc', 1)).toBe('abc:step1');
    expect(chainInput('abc', 2)).toBe('abc:step2');
    expect(powInput('abc', '42')).toBe('abc:42');
  });
});

// The widget hashes with the sync implementation in pow.ts while the server
// verifies with node:crypto, so a divergence between the two would break every
// real submission while every isolated test still passed. These pin them
// together — node:crypto is the reference, never the JS digest itself.
describe('sha256 vs node:crypto', () => {
  // Padding is the only part of SHA-256 with edge cases, and they all sit around
  // the 64-byte block and the 56-byte "no room left for the length" boundary.
  const lengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 1000];

  test.each(lengths)('matches at %i bytes', (n) => {
    const input = 'a'.repeat(n);
    expect(sha256Hex(input)).toBe(nodeHex(input));
  });

  test('matches for multi-byte UTF-8', () => {
    for (const input of ['héllo wörld', '日本語のテキスト', '🍡🧩', '\u{10ffff}']) {
      expect(sha256Hex(input)).toBe(nodeHex(input));
    }
  });

  test('matches across a spread of random inputs', () => {
    for (let i = 0; i < 200; i++) {
      const input = Math.random()
        .toString(36)
        .repeat((i % 9) + 1);
      expect(sha256Hex(input)).toBe(nodeHex(input));
    }
  });

  test('sha256Bytes agrees with sha256Hex', () => {
    expect(toHex(sha256Bytes('mochi'))).toBe(sha256Hex('mochi'));
    expect(sha256Bytes('mochi')).toHaveLength(32);
  });

  test('sha256LeadingZeroBits agrees with the digest it skips materialising', () => {
    for (let i = 0; i < 200; i++) {
      const input = `probe:${i}`;
      expect(sha256LeadingZeroBits(input)).toBe(leadingZeroBits(sha256Bytes(input)));
    }
  });
});

describe('deriveChain', () => {
  test('is identical under the JS and node hashers', () => {
    expect(deriveChain('a-token', sha256Hex)).toBe(deriveChain('a-token', nodeHex));
  });

  test('applies exactly CAPTCHA_STEPS links', () => {
    let expected = 'a-token';
    for (let step = 1; step <= CAPTCHA_STEPS; step++) {
      expected = nodeHex(chainInput(expected, step));
    }
    expect(deriveChain('a-token')).toBe(expected);
  });

  test('depends on the token', () => {
    expect(deriveChain('a-token')).not.toBe(deriveChain('b-token'));
  });
});

describe('solvePowSlice', () => {
  const challenge = deriveChain('slice-token');

  test('returns a nonce the server-side check accepts', () => {
    const result = solvePowSlice(challenge, 12, 0, 10_000);
    expect(result).toHaveProperty('nonce');
    const nonce = (result as { nonce: string }).nonce;
    expect(leadingZeroBits(new Uint8Array(createHash('sha256').update(powInput(challenge, nonce)).digest()))).toBeGreaterThanOrEqual(12);
  });

  test('resuming across slices finds the same nonce as one long slice', () => {
    const whole = solvePowSlice(challenge, 12, 0, 10_000) as { nonce: string };
    // A zero-length budget yields after every batch, so this exercises the resume
    // path the widget uses between animation frames.
    let next = 0;
    let resumed: string | null = null;
    for (let i = 0; i < 10_000 && resumed === null; i++) {
      const r = solvePowSlice(challenge, 12, next, 0);
      if ('nonce' in r) {
        resumed = r.nonce;
      } else {
        next = r.next;
      }
    }
    expect(resumed).toBe(whole.nonce);
  });

  test('yields without a solution when the budget runs out', () => {
    // 32 bits is far out of reach inside one batch, so this always yields.
    const result = solvePowSlice(challenge, 32, 0, 0);
    expect(result).not.toHaveProperty('nonce');
    expect((result as { next: number }).next).toBeGreaterThan(0);
  });

  test('honours the injected clock rather than wall time', () => {
    let now = 0;
    // Advances past the deadline on the second read, so exactly one batch runs.
    const result = solvePowSlice(challenge, 32, 0, 5, () => (now += 100));
    expect((result as { next: number }).next).toBe(512);
  });
});
