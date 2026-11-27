import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hasExecutableSql, loadMigrationFiles } from './loadMigrationFiles';
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

  test('sorts filenames numerically rather than lexicographically (9 before 10, 99 before 100)', async () => {
    const count = 105;
    const names = Array.from({ length: count }, (_, i) => `${i + 1}_step_${i + 1}.sql`).sort();
    expect(names.indexOf('10_step_10.sql')).toBeLessThan(names.indexOf('9_step_9.sql'));
    expect(names.indexOf('100_step_100.sql')).toBeLessThan(names.indexOf('99_step_99.sql'));
    for (const filename of names) {
      writeFileSync(path.join(dir, filename), 'SELECT 1;');
    }

    const files = await loadMigrationFiles(dir);
    expect(files.map((f) => f.id)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(files[8]!.filename).toBe('9_step_9.sql');
    expect(files[9]!.filename).toBe('10_step_10.sql');
    expect(files[98]!.filename).toBe('99_step_99.sql');
    expect(files[99]!.filename).toBe('100_step_100.sql');
  });

  test('ignores non-.sql files, dotfiles (including macOS AppleDouble), and returns [] for a missing dir', async () => {
    writeFileSync(path.join(dir, 'README.md'), 'docs');
    writeFileSync(path.join(dir, '.hidden.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, '._1_a.sql'), '\x00\x05\x16\x07macos resource fork');
    writeFileSync(path.join(dir, '1_a.sql'), 'SELECT 1;');
    expect((await loadMigrationFiles(dir)).map((f) => f.filename)).toEqual(['1_a.sql']);
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

  test('detects the no-transaction directive case-insensitively on word boundaries', async () => {
    writeFileSync(path.join(dir, '1_plain.sql'), '-- migrate:no-transaction-needed\nSELECT 1;');
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

describe('hasExecutableSql', () => {
  test('treats empty, comment-only, and semicolon-only inputs as non-executable', () => {
    expect(hasExecutableSql('')).toBe(false);
    expect(hasExecutableSql('   \n\t  ')).toBe(false);
    expect(hasExecutableSql('; ;; \n ;')).toBe(false);
    expect(hasExecutableSql('-- postgres only\n-- nothing for sqlite')).toBe(false);
    expect(hasExecutableSql('\uFEFF-- leading UTF-8 BOM + comment\n')).toBe(false);
    expect(hasExecutableSql('/* outer /* nested */ still comment */ ; -- line')).toBe(false);
  });

  test('treats statements and unclosed block comments as executable', () => {
    expect(hasExecutableSql('-- header\nCREATE TABLE t (id integer);')).toBe(true);
    expect(hasExecutableSql('/* unclosed comment')).toBe(true);
  });
});

describe('isValidStorage', () => {
  test('accepts sqlite file paths and postgres(ql) URLs, with and without startOnFail', () => {
    expect(isValidStorage({ type: 'sqlite', path: './app.db' })).toBe(true);
    expect(isValidStorage({ type: 'postgres', url: 'postgres://localhost/db' })).toBe(true);
    expect(isValidStorage({ type: 'postgres', url: 'postgresql://localhost:5432/db' })).toBe(true);
    expect(isValidStorage({ type: 'sqlite', path: './app.db', startOnFail: true })).toBe(true);
  });

  test('rejects non-objects, arrays, wrong types, empty/whitespace backings, memory sqlite, ?-query paths, and non-postgres URLs', () => {
    expect(isValidStorage(undefined)).toBe(false);
    expect(isValidStorage(null)).toBe(false);
    expect(isValidStorage([])).toBe(false);
    expect(isValidStorage('sqlite')).toBe(false);
    expect(isValidStorage({ type: 'mysql', url: 'mysql://localhost/db' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: '' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: '   ' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: ':memory:' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: 'sqlite://:memory:' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: 'file::memory:' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', path: './app.db?mode=ro' })).toBe(false);
    expect(isValidStorage({ type: 'sqlite', url: 'postgres://x' })).toBe(false);
    expect(isValidStorage({ type: 'postgres', url: '' })).toBe(false);
    expect(isValidStorage({ type: 'postgres', url: 'sqlite://./app.db' })).toBe(false);
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
