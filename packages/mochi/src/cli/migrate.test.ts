import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import { SQL } from 'bun';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runMigrateCommand } from './migrate';

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-migrate-cli-'));
const originalCwd = process.cwd();
let cwd: string;
let n = 0;

beforeEach(() => {
  cwd = path.join(root, `case-${n++}`);
  mkdirSync(cwd, { recursive: true });
  // Safe under per-file test isolation; the command resolves folders and the entry from cwd.
  process.chdir(cwd);
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
});

describe('runMigrateCommand', () => {
  test('--validate accepts valid folders for both database types and empty projects', async () => {
    mkdirSync(path.join(cwd, 'migrations', 'postgres'), { recursive: true });
    mkdirSync(path.join(cwd, 'migrations', 'sqlite'), { recursive: true });
    writeFileSync(path.join(cwd, 'migrations', 'postgres', '1_init.sql'), 'CREATE TABLE t (id integer);');
    writeFileSync(path.join(cwd, 'migrations', 'sqlite', '1_init.sql'), 'CREATE TABLE t (id integer);');
    await runMigrateCommand({ validate: true });

    rmSync(path.join(cwd, 'migrations'), { recursive: true });
    await runMigrateCommand({ validate: true });
  });

  test('--validate rejects a folder violating the naming rules', async () => {
    mkdirSync(path.join(cwd, 'migrations', 'sqlite'), { recursive: true });
    writeFileSync(path.join(cwd, 'migrations', 'sqlite', '2_gap.sql'), 'SELECT 1;');
    await expect(runMigrateCommand({ validate: true })).rejects.toThrow(/consecutive: expected 1, found 2/);
  });

  test('rejects a missing entry and an entry without a storage option', async () => {
    await expect(runMigrateCommand({})).rejects.toThrow(/Entry not found/);

    writeFileSync(path.join(cwd, 'entry.ts'), `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ port: 0, routes: {} });\n`);
    await expect(runMigrateCommand({ entry: './entry.ts' })).rejects.toThrow(/No `storage` found/);
  });

  test('applies pending migrations using the storage captured from the entry', async () => {
    mkdirSync(path.join(cwd, 'migrations', 'sqlite'), { recursive: true });
    writeFileSync(path.join(cwd, 'migrations', 'sqlite', '1_users.sql'), 'CREATE TABLE users (id integer PRIMARY KEY);');
    writeFileSync(path.join(cwd, 'entry.ts'), `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ port: 0, routes: {}, storage: { sqlite: './app.db' } });\n`);
    await runMigrateCommand({ entry: './entry.ts' });

    const sql = new SQL(`sqlite://${path.join(cwd, 'app.db')}`);
    try {
      const rows = (await sql.unsafe('SELECT id, name FROM migrations')) as { id: number; name: string }[];
      expect(rows).toEqual([{ id: 1, name: 'users' }]);
    } finally {
      await sql.close();
    }
  });
});
