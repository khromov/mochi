import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { decryptProps, encryptProps } from './serverIslandCrypto';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const DEFAULT_SECRET = 'test-key-for-unit-tests-32bytes!';
const RUNS = { numRuns: 2000 };

function installConfig(secret: string) {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from(secret),
  };
}

beforeAll(() => installConfig(DEFAULT_SECRET));
afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
});

describe('serverIslandCrypto — property-based fuzzing', () => {
  test('props round-trip through encrypt/decrypt for any component name', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (props, componentName) => {
        installConfig(DEFAULT_SECRET);
        const token = encryptProps(props, componentName);
        expect(decryptProps(token, componentName)).toBe(props);
      }),
      RUNS,
    );
  });

  test('AAD binding: a token sealed for one component never opens under another', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (props, nameA, nameB) => {
        // Compare the utf-8 *bytes*, not the JS strings: distinct strings holding
        // lone surrogates both encode to U+FFFD, yielding identical AAD — that's a
        // genuine collision, not a violation, so it must be excluded.
        fc.pre(!Buffer.from(nameA).equals(Buffer.from(nameB)));
        installConfig(DEFAULT_SECRET);
        const token = encryptProps(props, nameA);
        expect(decryptProps(token, nameB)).toBeNull();
      }),
      RUNS,
    );
  });

  test('HMAC key derivation: a token minted under one secret never opens under a different secret', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.string(), fc.string(), (secretA, secretB, props, name) => {
        fc.pre(!Buffer.from(secretA).equals(Buffer.from(secretB)));
        installConfig(secretA);
        const token = encryptProps(props, name);
        installConfig(secretB);
        expect(decryptProps(token, name)).toBeNull();
      }),
      RUNS,
    );
  });
});
