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
  test('--validate accepts valid folders for both database types and reports empty projects', async () => {
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

  test('distinguishes a missing entry, missing storage, and invalid storage', async () => {
    await expect(runMigrateCommand({})).rejects.toThrow(/Entry not found/);

    writeFileSync(path.join(cwd, 'no-storage.ts'), `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ port: 0, routes: {} });\n`);
    await expect(runMigrateCommand({ entry: './no-storage.ts' })).rejects.toThrow(/No `storage` found/);

    writeFileSync(
      path.join(cwd, 'bad-storage.ts'),
      `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ port: 0, routes: {}, storage: { type: 'postgres', url: '' } });\n`,
    );
    await expect(runMigrateCommand({ entry: './bad-storage.ts' })).rejects.toThrow(/Invalid `storage`/);
  });

  test('applies pending migrations into mochi_migrations using the storage captured from Mochi.serve()', async () => {
    mkdirSync(path.join(cwd, 'migrations', 'sqlite'), { recursive: true });
    writeFileSync(path.join(cwd, 'migrations', 'sqlite', '1_users.sql'), 'CREATE TABLE users (id integer PRIMARY KEY);');
    writeFileSync(
      path.join(cwd, 'entry.ts'),
      `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ port: 0, routes: {}, storage: { type: 'sqlite', path: './app.db' } });\n`,
    );
    await runMigrateCommand({ entry: './entry.ts' });

    const sql = new SQL({ adapter: 'sqlite', filename: path.join(cwd, 'app.db') });
    try {
      const rows = (await sql.unsafe('SELECT id, name FROM mochi_migrations')) as { id: number; name: string }[];
      expect(rows).toEqual([{ id: 1, name: 'users' }]);
    } finally {
      await sql.close();
    }
  });

  test('rejects on a failed migration even when the entry declares startOnFail: true', async () => {
    mkdirSync(path.join(cwd, 'migrations', 'sqlite'), { recursive: true });
    writeFileSync(path.join(cwd, 'migrations', 'sqlite', '1_broken.sql'), 'CREATE TABLE broken (;');
    writeFileSync(
      path.join(cwd, 'entry-start-on-fail.ts'),
      `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ port: 0, routes: {}, storage: { type: 'sqlite', path: './fail.db', startOnFail: true } });\n`,
    );
    await expect(runMigrateCommand({ entry: './entry-start-on-fail.ts' })).rejects.toThrow(/syntax error/);
  });

  test('extracts storage from a standalone Mochi.worker() entry without starting the worker', async () => {
    mkdirSync(path.join(cwd, 'migrations', 'sqlite'), { recursive: true });
    writeFileSync(path.join(cwd, 'migrations', 'sqlite', '1_jobs_meta.sql'), 'CREATE TABLE jobs_meta (id integer PRIMARY KEY);');
    writeFileSync(
      path.join(cwd, 'worker.ts'),
      `import { Mochi } from 'mochi-framework';
const q = Mochi.queue('emails', { storage: 'memory', process: async () => {} });
const worker = Mochi.worker({ queues: [q], storage: { type: 'sqlite', path: './worker.db' } });
await worker.start();
`,
    );
    await runMigrateCommand({ entry: './worker.ts' });

    const sql = new SQL({ adapter: 'sqlite', filename: path.join(cwd, 'worker.db') });
    try {
      const rows = (await sql.unsafe('SELECT id, name FROM mochi_migrations')) as { id: number; name: string }[];
      expect(rows).toEqual([{ id: 1, name: 'jobs_meta' }]);
    } finally {
      await sql.close();
    }
  });
});
