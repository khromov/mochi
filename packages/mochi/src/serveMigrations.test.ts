import { afterAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import type { Server } from 'bun';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { runStartupMigrations } from './migrations/startup';
import { resetStartupMilestones } from './lifecycle';

const projectDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-migrations-'));
const migrationsDir = path.join(projectDir, 'migrations', 'sqlite');
const originalCwd = process.cwd();
let server: Server<undefined> | undefined;

mkdirSync(migrationsDir, { recursive: true });
// Safe under per-file test isolation; runStartupMigrations resolves the app folder from cwd.
process.chdir(projectDir);

afterAll(() => {
  server?.stop(true);
  resetStartupMilestones();
  process.chdir(originalCwd);
  rmSync(projectDir, { recursive: true, force: true });
});

async function tables(db: string): Promise<string[]> {
  const sql = new SQL(`sqlite://${db}`);
  try {
    const rows = (await sql.unsafe("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")) as { name: string }[];
    return rows.map((r) => r.name);
  } finally {
    await sql.close();
  }
}

describe('Mochi.serve({ storage })', () => {
  test('rejects an invalid storage before binding', async () => {
    expect(Mochi.serve({ port: 0, development: false, logger: { enabled: false }, routes: {}, storage: { sqlite: '' } as never })).rejects.toThrow(
      /Mochi\.serve\(\{ storage \}\): expected/,
    );
  });

  test('a failing migration rejects serve() and leaves the process retryable', async () => {
    const db = path.join(projectDir, 'failing.db');
    writeFileSync(path.join(migrationsDir, '1_bad.sql'), 'CREATE TABLE broken (;');
    await expect(Mochi.serve({ port: 0, development: false, logger: { enabled: false }, routes: {}, storage: { sqlite: db } })).rejects.toThrow(/syntax error/);
    expect(existsSync(path.join(projectDir, '.mochi'))).toBe(false);
  });

  test('applies migrations before binding, and repeat runs on the same storage are deduped', async () => {
    const db = path.join(projectDir, 'app.db');
    writeFileSync(path.join(migrationsDir, '1_bad.sql'), 'CREATE TABLE users (id integer PRIMARY KEY, name text);');
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: path.join(projectDir, '.mochi'),
      routes: {},
      storage: { sqlite: db },
    });

    expect(await tables(db)).toEqual(['migrations', 'users']);

    // Same-process re-run on the same storage (a Mochi.worker booting alongside) reuses the completed run.
    const first = await runStartupMigrations({ sqlite: db });
    const second = await runStartupMigrations({ sqlite: db });
    expect(second).toBe(first);
    expect(first.map((m) => m.filename)).toEqual(['1_bad.sql']);
  });
});
