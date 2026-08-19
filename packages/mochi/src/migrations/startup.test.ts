import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runStartupMigrations } from './startup';

const projectDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-migrate-startup-'));
const migrationsDir = path.join(projectDir, 'migrations', 'sqlite');
const originalCwd = process.cwd();

mkdirSync(migrationsDir, { recursive: true });
// Safe under per-file test isolation; runStartupMigrations resolves the app folder from cwd.
process.chdir(projectDir);

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(projectDir, { recursive: true, force: true });
});

describe('runStartupMigrations', () => {
  test('startOnFail swallows a failing migration instead of rejecting the boot', async () => {
    writeFileSync(path.join(migrationsDir, '1_bad.sql'), 'CREATE TABLE broken (;');
    const db = path.join(projectDir, 'app.db');

    await expect(runStartupMigrations({ type: 'sqlite', path: db })).rejects.toThrow(/syntax error/);
    expect(await runStartupMigrations({ type: 'sqlite', path: db, startOnFail: true })).toEqual([]);
  });
});
