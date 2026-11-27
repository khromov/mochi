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

  test('handles zero-prefixed filenames (001..010..0100) as decimal ids while rejecting 000', async () => {
    writeFileSync(path.join(dir, '000-xoxo.sql'), 'SELECT 1;');
    await expect(loadMigrationFiles(dir)).rejects.toThrow(/Invalid migration file name/);
    rmSync(path.join(dir, '000-xoxo.sql'));

    const zeroPrefixed = [
      '010-tenth.sql',
      '002-second.sql',
      '0011-eleventh.sql',
      '001-xoxoxo.sql',
      '009-ninth.sql',
      '008-eighth.sql',
      '003-third.sql',
      '007-seventh.sql',
      '004-fourth.sql',
      '006-sixth.sql',
      '005-fifth.sql',
      '012.sql',
    ];
    for (const filename of zeroPrefixed) {
      writeFileSync(path.join(dir, filename), 'SELECT 1;');
    }

    const files = await loadMigrationFiles(dir);
    expect(files.map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(files.map((f) => f.filename)).toEqual([
      '001-xoxoxo.sql',
      '002-second.sql',
      '003-third.sql',
      '004-fourth.sql',
      '005-fifth.sql',
      '006-sixth.sql',
      '007-seventh.sql',
      '008-eighth.sql',
      '009-ninth.sql',
      '010-tenth.sql',
      '0011-eleventh.sql',
      '012.sql',
    ]);
    expect(files[0]!.name).toBe('xoxoxo');
    expect(files[11]!.name).toBe('12');

    // Differently zero-padded filenames for the same numeric id collide as duplicates.
    writeFileSync(path.join(dir, '01-dup.sql'), 'SELECT 1;');
    await expect(loadMigrationFiles(dir)).rejects.toThrow(/Duplicate migration id 1/);
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

  test('detects the no-transaction directive only in real line comments on word boundaries', async () => {
    writeFileSync(path.join(dir, '1_plain.sql'), '-- migrate:no-transaction-needed\nSELECT 1;');
    writeFileSync(path.join(dir, '2_string.sql'), "INSERT INTO notes (body) VALUES ('-- migrate:no-transaction');");
    writeFileSync(path.join(dir, '3_block.sql'), '/* -- migrate:no-transaction */\nSELECT 1;');
    writeFileSync(path.join(dir, '4_no_tx.sql'), '--   MIGRATE:NO-TRANSACTION\nCREATE INDEX idx ON t (id);');
    const files = await loadMigrationFiles(dir);
    expect(files.map((f) => f.noTransaction)).toEqual([false, false, false, true]);
  });

  test('parses SQL statements, ignoring comments/empty semicolons while surfacing unclosed comments', async () => {
    writeFileSync(path.join(dir, '1_empty.sql'), '   \n\t ; ;; \n');
    writeFileSync(path.join(dir, '2_comments.sql'), '\uFEFF-- leading BOM + line comment\n/* outer /* nested ; */ comment */ ; -- trailing');
    writeFileSync(path.join(dir, '3_unclosed.sql'), '/* unclosed block comment');
    writeFileSync(path.join(dir, '4_multi.sql'), '-- header\nCREATE TABLE t (id integer);\nINSERT INTO t VALUES (1);');
    const files = await loadMigrationFiles(dir);
    expect(files[0]!.statements).toEqual([]);
    expect(files[1]!.statements).toEqual([]);
    expect(files[2]!.statements).toEqual(['/* unclosed block comment']);
    expect(files[3]!.statements).toEqual(['CREATE TABLE t (id integer)', 'INSERT INTO t VALUES (1)']);
  });

  test('rejects top-level BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK, and ABORT unless no-transaction is set', async () => {
    const forbiddenCases: [string, RegExp][] = [
      ['BEGIN;\nCREATE TABLE t (id integer);', /explicit "BEGIN" statement/],
      ['BEGIN IMMEDIATE;\nCREATE TABLE t (id integer);', /explicit "BEGIN" statement/],
      ['START TRANSACTION;\nCREATE TABLE t (id integer);', /explicit "START TRANSACTION" statement/],
      ['CREATE TABLE t (id integer);\n/* comment */ COMMIT;', /explicit "COMMIT" statement/],
      ['CREATE TABLE t (id integer);\nEND TRANSACTION;', /explicit "END" statement/],
      ['CREATE TABLE t (id integer);\nROLLBACK;', /explicit "ROLLBACK" statement/],
      ['CREATE TABLE t (id integer);\nROLLBACK WORK;', /explicit "ROLLBACK" statement/],
      ['CREATE TABLE t (id integer);\nABORT;', /explicit "ABORT" statement/],
      ['SELECT 1 AS begin;\nCOMMIT;', /explicit "COMMIT" statement/],
      ['CREATE TABLE copy_t AS SELECT begin FROM events;\nROLLBACK;', /explicit "ROLLBACK" statement/],
    ];

    for (const [sql, expected] of forbiddenCases) {
      writeFileSync(path.join(dir, '1_bad.sql'), sql);
      let message = '';
      await loadMigrationFiles(dir).catch((err: Error) => {
        message = err.message;
      });
      expect(message).toMatch(expected);
      expect(message).not.toContain('\\');
    }

    // With -- migrate:no-transaction, explicit transaction batching is permitted.
    writeFileSync(path.join(dir, '1_bad.sql'), '-- migrate:no-transaction\nBEGIN;\nCREATE TABLE t (id integer);\nCOMMIT;\nVACUUM;');
    const [allowed] = await loadMigrationFiles(dir);
    expect(allowed!.noTransaction).toBe(true);
    expect(allowed!.statements.length).toBe(4);
  });

  test('allows triggers, BEGIN ATOMIC, dollar-quoted blocks, savepoints, strings, comments, and identifiers', async () => {
    writeFileSync(
      path.join(dir, '1_sqlite_trigger.sql'),
      `CREATE TRIGGER tr_audit AFTER UPDATE ON users
       WHEN CASE WHEN NEW.active = 1 THEN 1 ELSE 0 END = 1
       BEGIN
         INSERT INTO audit_log (note) VALUES ('COMMIT; ROLLBACK; BEGIN;');
         UPDATE stats SET ended_at = NEW.end, kind = CASE WHEN NEW.role = 'admin' THEN 'a' ELSE 'u' END;
         SELECT CASE WHEN NEW.blocked = 1 THEN RAISE(ROLLBACK, 'blocked;abort') END;
       END;
       CREATE TABLE \`begin\` ("commit" text, [rollback] text, commit_sha text, rollback_at text);`,
    );
    writeFileSync(
      path.join(dir, '2_pg_blocks.sql'),
      `CREATE OR REPLACE FUNCTION bump() RETURNS trigger AS $fn$
       BEGIN
         IF NEW.n < 0 THEN
           RAISE EXCEPTION 'ROLLBACK; COMMIT;';
         END IF;
         RETURN NEW;
       END;
       $fn$ LANGUAGE plpgsql;

       CREATE FUNCTION add1(x int) RETURNS int LANGUAGE sql
       BEGIN /* sql body */ ATOMIC
         SELECT x + 1;
       END;

       INSERT INTO notes (body, tags) VALUES (E'line1\\n; COMMIT; \\'still string\\'', ARRAY['a]b; ROLLBACK;', 'c']);`,
    );
    writeFileSync(
      path.join(dir, '3_savepoints.sql'),
      `SAVEPOINT sp1;
       INSERT INTO notes (body) VALUES ('try');
       ROLLBACK TO sp1;
       ROLLBACK TRANSACTION TO SAVEPOINT sp1;
       RELEASE SAVEPOINT sp1;
       -- BEGIN; COMMIT; ROLLBACK;`,
    );

    const files = await loadMigrationFiles(dir);
    expect(files.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(files[0]!.statements.length).toBe(2);
    expect(files[1]!.statements.length).toBe(3);
    expect(files[2]!.statements.length).toBe(5);
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
