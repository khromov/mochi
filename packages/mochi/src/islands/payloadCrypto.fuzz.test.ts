import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { decryptPayload, decryptPayloadBytes, encryptPayload, encryptPayloadBytes } from './payloadCrypto';
import { toPosixPath } from '../utils';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

// Bumped above fast-check's default of 100 so each property explores more of
// the input space on every `bun test` run — still finishes in well under a second.
const RUNS = { numRuns: 2000 };

// fc.string() (and even unit:'binary') never emit lone surrogates, so this
// explicit generator is the only way to exercise the UTF-8 normalization edge in
// `encryptPayload` (see the "UTF-8 contract" test below).
const surrogateString = fc
  .array(fc.oneof(fc.integer({ min: 0xd800, max: 0xdfff }), fc.integer({ min: 0x61, max: 0x7a })), { maxLength: 16 })
  .map((codes) => String.fromCharCode(...codes));

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
});

describe('payloadCrypto — property-based fuzzing', () => {
  test('string round-trips identically for arbitrary valid-Unicode input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decryptPayload(encryptPayload(s))).toBe(s);
      }),
      RUNS,
    );
  });

  // encryptPayload does `Buffer.from(s, 'utf-8')`, which replaces lone surrogates
  // with U+FFFD — so the round-trip is identity only up to UTF-8 normalization.
  // The precise, universally-true contract is "round-trips the UTF-8 encoding of
  // s". Real props are always valid strings; the Bytes API is the lossless path.
  test('string round-trip honors the UTF-8 normalization contract (lone surrogates → U+FFFD)', () => {
    fc.assert(
      fc.property(surrogateString, (s) => {
        const normalized = Buffer.from(s, 'utf-8').toString('utf-8');
        expect(decryptPayload(encryptPayload(s))).toBe(normalized);
      }),
      RUNS,
    );
  });

  test('string round-trips across the compression threshold', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 200, maxLength: 4000 }), (s) => {
        expect(decryptPayload(encryptPayload(s))).toBe(s);
      }),
      RUNS,
    );
  });

  // Random text rarely deflates smaller, so the threshold test above can skip the compressed
  // branch entirely — repetitive input forces it, proven by the token beating compress:false.
  test('compressible input provably takes the deflate branch and round-trips', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), fc.integer({ min: 200, max: 400 }), (chunk, n) => {
        const s = chunk.repeat(n);
        const token = encryptPayload(s);
        expect(token.length).toBeLessThan(encryptPayload(s, { compress: false }).length);
        expect(decryptPayload(token)).toBe(s);
      }),
      RUNS,
    );
  });

  test('bytes round-trip for arbitrary buffers', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        const out = decryptPayloadBytes(encryptPayloadBytes(bytes));
        expect(out).not.toBeNull();
        expect(Buffer.from(bytes).equals(out!)).toBe(true);
      }),
      RUNS,
    );
  });

  test('compress on/off both round-trip to the same value', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decryptPayload(encryptPayload(s, { compress: false }))).toBe(s);
        expect(decryptPayload(encryptPayload(s, { compress: true }))).toBe(s);
      }),
      RUNS,
    );
  });

  test('AAD binding: decrypting with a different aad yields null', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (s, a, b) => {
        // Distinguish by utf-8 bytes, not JS string identity: lone surrogates
        // both encode to U+FFFD, so two unequal strings can share one aad.
        fc.pre(!Buffer.from(a).equals(Buffer.from(b)));
        expect(decryptPayload(encryptPayload(s, { aad: a }), { aad: b })).toBeNull();
      }),
      RUNS,
    );
  });

  test('decryptPayload never throws on arbitrary garbage tokens', () => {
    // Forging AES-SIV's 128-bit tag by chance is negligible, so garbage must yield null
    // (any throw fails fc.assert on its own).
    fc.assert(
      fc.property(fc.string(), (token) => {
        expect(decryptPayload(token)).toBeNull();
      }),
      RUNS,
    );
    // Guards against decryptPayload trivially returning null for everything.
    expect(decryptPayload(encryptPayload('sanity'))).toBe('sanity');
  });
});

describe('toPosixPath — property-based fuzzing', () => {
  test('output never contains a backslash', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(toPosixPath(s).includes('\\')).toBe(false);
      }),
      RUNS,
    );
  });

  test('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = toPosixPath(s);
        expect(toPosixPath(once)).toBe(once);
      }),
      RUNS,
    );
  });

  test('preserves length (1:1 char replacement)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(toPosixPath(s).length).toBe(s.length);
      }),
      RUNS,
    );
  });
});
