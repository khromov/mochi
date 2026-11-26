import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { initExtensions } from './extensions';
import { getMochiConfig, initMochiConfig } from './mochiConfig';

const GLOBAL_KEY = '__mochi_config__';
const originalKey = process.env.MOCHI_KEY;

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
  initExtensions({});
  if (originalKey === undefined) {
    delete process.env.MOCHI_KEY;
  } else {
    process.env.MOCHI_KEY = originalKey;
  }
});

describe('initMochiConfig secret key', () => {
  test.each(['""', "''", ' ', 'x', '=', '@@@'])('refuses to start when MOCHI_KEY=%p decodes to zero bytes', async (value) => {
    process.env.MOCHI_KEY = value;
    await expect(initMochiConfig({})).rejects.toThrow(/secret key is empty/);
    expect(() => getMochiConfig()).toThrow('Mochi.serve() has not been called yet.');
  });

  test.each(['AA', 'A'.repeat(43)])('refuses to start when MOCHI_KEY=%p decodes to only zero bytes', async (value) => {
    process.env.MOCHI_KEY = value;
    await expect(initMochiConfig({})).rejects.toThrow(/secret key is empty or all zero bytes/);
    expect(() => getMochiConfig()).toThrow('Mochi.serve() has not been called yet.');
  });

  test.each([0, 32])('refuses to start when the serverIsland:secretKey filter returns %p zero bytes', async (length) => {
    delete process.env.MOCHI_KEY;
    initExtensions({ filters: { 'serverIsland:secretKey': async () => Buffer.alloc(length) } });
    await expect(initMochiConfig({})).rejects.toThrow(/secret key is empty/);
  });

  test('uses the decoded MOCHI_KEY bytes', async () => {
    const key = randomBytes(32);
    process.env.MOCHI_KEY = key.toString('base64url');
    await initMochiConfig({});
    expect(getMochiConfig().secretKey.equals(key)).toBe(true);
  });

  test('still accepts a short non-empty MOCHI_KEY', async () => {
    process.env.MOCHI_KEY = 'changeme';
    await initMochiConfig({});
    expect(getMochiConfig().secretKey.length).toBe(6);
  });

  test('generates a random 32-byte key when MOCHI_KEY is unset', async () => {
    delete process.env.MOCHI_KEY;
    await initMochiConfig({});
    expect(getMochiConfig().secretKey.length).toBe(32);
  });
});
