import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MemoryNonceStore, SqliteNonceStore } from './nonceStore';

const dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-nonce-test-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const future = () => Date.now() + 60_000;

describe('MemoryNonceStore', () => {
  test('a nonce is consumable exactly once', () => {
    const store = new MemoryNonceStore();
    expect(store.consume('a', future())).toBe(true);
    expect(store.consume('a', future())).toBe(false);
  });

  test('an expired nonce is pruned and consumable again', () => {
    const store = new MemoryNonceStore();
    expect(store.consume('a', Date.now() - 1)).toBe(true);
    expect(store.consume('a', future())).toBe(true);
  });
});

describe('SqliteNonceStore', () => {
  test('a nonce is consumable exactly once', () => {
    const store = new SqliteNonceStore(path.join(dir, 'once.sqlite'));
    expect(store.consume('a', future())).toBe(true);
    expect(store.consume('a', future())).toBe(false);
  });

  test('an expired nonce is pruned and consumable again', () => {
    const store = new SqliteNonceStore(path.join(dir, 'expired.sqlite'));
    expect(store.consume('a', Date.now() - 1)).toBe(true);
    expect(store.consume('a', future())).toBe(true);
  });

  test('seen nonces survive across store instances on the same file', () => {
    const file = path.join(dir, 'persist.sqlite');
    expect(new SqliteNonceStore(file).consume('a', future())).toBe(true);
    expect(new SqliteNonceStore(file).consume('a', future())).toBe(false);
  });
});
