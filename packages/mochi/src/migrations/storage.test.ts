import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { isValidStorage, storageDbType, storageKey } from './storage';

describe('isValidStorage', () => {
  test('accepts both variants, with and without startOnFail', () => {
    expect(isValidStorage({ type: 'sqlite', path: './app.db' })).toBe(true);
    expect(isValidStorage({ type: 'postgres', url: 'postgres://localhost/db' })).toBe(true);
    expect(isValidStorage({ type: 'sqlite', path: './app.db', startOnFail: true })).toBe(true);
  });

  test('rejects non-objects, wrong types, empty backings, and mismatched fields', () => {
    expect(isValidStorage(undefined)).toBe(false);
    expect(isValidStorage('sqlite')).toBe(false);
    expect(isValidStorage({ type: 'mysql', url: 'x' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: '' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', url: 'postgres://x' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: './a.db', startOnFail: 'yes' })).toBe(false);
  });

  test('rejects unknown keys instead of silently ignoring them', () => {
    expect(isValidStorage({ type: 'sqlite', path: './a.db', posgres: 'oops' })).toBe(false);
    expect(isValidStorage({ sqlite: './a.db' })).toBe(false);
  });
});

describe('storage helpers', () => {
  test('storageDbType and storageKey derive from the variant', () => {
    expect(storageDbType({ type: 'sqlite', path: './a.db' })).toBe('sqlite');
    expect(storageDbType({ type: 'postgres', url: 'postgres://x' })).toBe('postgres');
    expect(storageKey({ type: 'sqlite', path: './a.db' })).toBe(`sqlite:${path.resolve('./a.db')}`);
    expect(storageKey({ type: 'postgres', url: 'postgres://x' })).toBe('postgres:postgres://x');
  });
});
