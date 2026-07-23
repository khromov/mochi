import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { decryptPayload, decryptPayloadBytes, encryptPayload, encryptPayloadBytes } from './payloadCrypto';
import { toPosixPath } from '../utils';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

// Bumped above fast-check's default of 100 so each property explores more of
// the input space on every `bun test` run — still finishes in well under a second.
const RUNS = { numRuns: 2000 };

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
  test('string round-trips for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decryptPayload(encryptPayload(s))).toBe(s);
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
        fc.pre(a !== b);
        expect(decryptPayload(encryptPayload(s, { aad: a }), { aad: b })).toBeNull();
      }),
      RUNS,
    );
  });

  test('decryptPayload never throws on arbitrary garbage tokens', () => {
    fc.assert(
      fc.property(fc.string(), (token) => {
        const out = decryptPayload(token);
        expect(out === null || typeof out === 'string').toBe(true);
      }),
      RUNS,
    );
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
