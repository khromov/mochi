import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadMigrationFiles } from './loadMigrationFiles';
import { isValidStorage, storageKey } from './storage';

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-migrate-load-'));
let dir: string;
let n = 0;

beforeEach(() => {
  dir = path.join(root, `case-${n++}`);
  mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadMigrationFiles', () => {
  test('parses ids, separators, and names, sorted by id', async () => {
    writeFileSync(path.join(dir, '2-add_users.sql'), 'CREATE TABLE users (id integer);');
    writeFileSync(path.join(dir, '1_init.sql'), 'CREATE TABLE t (id integer);');
    writeFileSync(path.join(dir, '3.sql'), 'CREATE TABLE x (id integer);');
    const files = await loadMigrationFiles(dir);
    expect(files.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(files.map((f) => f.name)).toEqual(['init', 'add_users', '3']);
    expect(files[0]!.filename).toBe('1_init.sql');
  });

  test('ignores non-.sql files (READMEs) and returns [] for a missing dir', async () => {
    writeFileSync(path.join(dir, 'README.md'), 'docs');
    writeFileSync(path.join(dir, '1_a.sql'), 'SELECT 1;');
    expect((await loadMigrationFiles(dir)).length).toBe(1);
    expect(await loadMigrationFiles(path.join(dir, 'nope'))).toEqual([]);
  });

  test('rejects unparseable names, non-positive ids, duplicates, and gaps', async () => {
    writeFileSync(path.join(dir, 'init.sql'), 'SELECT 1;');
    await expect(loadMigrationFiles(dir)).rejects.toThrow(/Invalid migration file name/);
    rmSync(path.join(dir, 'init.sql'));

    writeFileSync(path.join(dir, '0_zero.sql'), 'SELECT 1;');
    await expect(loadMigrationFiles(dir)).rejects.toThrow(/Invalid migration file name/);
    rmSync(path.join(dir, '0_zero.sql'));

    writeFileSync(path.join(dir, '1_a.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, '1-b.sql'), 'SELECT 1;');
    await expect(loadMigrationFiles(dir)).rejects.toThrow(/Duplicate migration id 1/);
    rmSync(path.join(dir, '1-b.sql'));

    writeFileSync(path.join(dir, '3_gap.sql'), 'SELECT 1;');
    await expect(loadMigrationFiles(dir)).rejects.toThrow(/consecutive: expected 2, found 3/);
  });

  test('hashes identically across CRLF and LF line endings', async () => {
    writeFileSync(path.join(dir, '1_lf.sql'), 'SELECT 1;\nSELECT 2;\n');
    const other = path.join(root, `case-${n++}`);
    mkdirSync(other);
    writeFileSync(path.join(other, '1_lf.sql'), 'SELECT 1;\r\nSELECT 2;\r\n');
    const [a] = await loadMigrationFiles(dir);
    const [b] = await loadMigrationFiles(other);
    expect(a!.hash).toBe(b!.hash);
    expect(a!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('detects the no-transaction directive case-insensitively', async () => {
    writeFileSync(path.join(dir, '1_plain.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, '2_no_tx.sql'), '--   MIGRATE:NO-TRANSACTION\nCREATE INDEX idx ON t (id);');
    const files = await loadMigrationFiles(dir);
    expect(files.map((f) => f.noTransaction)).toEqual([false, true]);
  });

  test('error messages use forward-slash paths', async () => {
    writeFileSync(path.join(dir, 'broken.sql'), 'SELECT 1;');
    let message = '';
    await loadMigrationFiles(dir).catch((err: Error) => {
      message = err.message;
    });
    expect(message).toContain('broken.sql');
    expect(message).not.toContain('\\');
  });
});

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

describe('storageKey', () => {
  test('derives a stable per-database identity from the variant', () => {
    expect(storageKey({ type: 'sqlite', path: './a.db' })).toBe(`sqlite:${path.resolve('./a.db')}`);
    expect(storageKey({ type: 'postgres', url: 'postgres://x' })).toBe('postgres:postgres://x');
  });
});
