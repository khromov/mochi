import { afterEach, describe, expect, test } from 'bun:test';
import { stringify as devalueStringify } from 'devalue';
import { signProps } from '../serverIslandCrypto';
import { decodeSignedProps, parseHydratableProps } from './decodeProps';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig(opts: Record<string, unknown> = {}) {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: opts,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
});

describe('decodeSignedProps', () => {
  test('round-trips an uncompressed payload', async () => {
    installConfig();
    const props = { islandId: 'mochi-abc-0', name: 'World', count: 3 };
    const token = signProps(devalueStringify(props));
    // Short payload → no compression marker.
    expect(token.startsWith('~')).toBe(false);

    expect(await decodeSignedProps(token)).toEqual(props);
  });

  test('round-trips a compressed payload (the `~` deflate-raw branch)', async () => {
    installConfig();
    // A long, repetitive payload (≥64 bytes) compresses, so signProps emits the
    // `~`-prefixed raw-deflate form that the browser decodes with deflate-raw.
    const props = { islandId: 'mochi-abc-1', data: 'a'.repeat(500) };
    const token = signProps(devalueStringify(props));
    expect(token.startsWith('~')).toBe(true);

    expect(await decodeSignedProps(token)).toEqual(props);
  });
});

describe('parseHydratableProps', () => {
  test('parses devalue-serialized props back to the original object graph', () => {
    const props = { items: [1, 2, 3], nested: { x: 0 } };
    expect(parseHydratableProps(devalueStringify(props))).toEqual(props);
  });
});
