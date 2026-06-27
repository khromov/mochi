import { afterEach, describe, expect, test } from 'bun:test';
import { stringify as devalueStringify } from 'devalue';
import { signProps, verifyAndDecodeProps } from './serverIslandCrypto';

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

afterEach(() => {
  removeConfig();
});

describe('signProps + verifyAndDecodeProps', () => {
  test('round-trips: verify decodes what sign produces', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0', name: 'World' });
    const token = signProps(json);
    const decoded = verifyAndDecodeProps(token);
    expect(decoded).toBe(json);
  });

  test('rejects a tampered token', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0' });
    const token = signProps(json);
    const tampered = 'X' + token.slice(1);
    expect(verifyAndDecodeProps(tampered)).toBeNull();
  });

  test('rejects a token with no dot separator', () => {
    expect(verifyAndDecodeProps('nodothere')).toBeNull();
  });
});
