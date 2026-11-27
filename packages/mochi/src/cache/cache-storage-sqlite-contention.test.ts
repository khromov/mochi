import { afterEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MochiCache } from './cache';
import { SqliteStorage } from './cache-storage';
import { sqlCacheTuning } from './sql-backend';
import { mochiEvents } from '../events';

// Lock contention between processes: every test here holds or races for the SQLite write lock from a second process,
// so they are slower than, and kept apart from, the rest of the SqliteStorage suite.
const wait = Bun.sleep;

const tuningDefaults = { ...sqlCacheTuning };
const storageModuleUrl = Bun.pathToFileURL(join(import.meta.dir, 'cache-storage.ts')).href;
const created: SqliteStorage[] = [];
const dirs: string[] = [];

function makeDbPath(name = 'cache.sqlite'): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-sqlitecache-lock-'));
  dirs.push(dir);
  return join(dir, name);
}

function makeStorage(options: Partial<ConstructorParameters<typeof SqliteStorage>[0]> = {}): SqliteStorage {
  const storage = new SqliteStorage({ path: options.path ?? makeDbPath(), purgeInterval: 0, ...options });
  created.push(storage);
  return storage;
}

afterEach(async () => {
  mochiEvents.all.clear();
  Object.assign(sqlCacheTuning, tuningDefaults);
  for (const storage of created) {
    await storage.dispose();
  }
  created.length = 0;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

// SQLite's busy handler sleeps the calling thread, so a lock this process could wait on must be held by another one.
async function holdWriteLock(dbPath: string, ms: number): Promise<{ exited: Promise<number> }> {
  const proc = Bun.spawn(
    [
      process.execPath,
      '-e',
      `import { Database } from 'bun:sqlite';
       const db = new Database(process.argv[1]);
       db.exec('BEGIN IMMEDIATE');
       process.stdout.write('locked\\n');
       await Bun.sleep(Number(process.argv[2]));
       db.exec('COMMIT');
       db.close();`,
      dbPath,
      String(ms),
    ],
    { stdout: 'pipe', stderr: 'inherit' },
  );
  const reader = proc.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  return { exited: proc.exited };
}

async function queryDb<T = Record<string, unknown>>(dbPath: string, query: string, params: unknown[] = []): Promise<T[]> {
  const sql = new SQL({ adapter: 'sqlite', filename: dbPath });
  try {
    return (await sql.unsafe(query, params)) as T[];
  } finally {
    await sql.close();
  }
}

describe('SqliteStorage under cross-process lock contention', () => {
  test('retries the WAL switch while another process holds the write lock, and skips it once the file is in WAL mode', async () => {
    // Already holds tables but is still in the default rollback-journal mode, as after a plain bun:sqlite or migration run.
    const dbPath = makeDbPath('wal-lock.sqlite');
    await queryDb(dbPath, 'CREATE TABLE seed_check (x integer)');
    expect((await queryDb<{ journal_mode: string }>(dbPath, 'PRAGMA journal_mode'))[0]!.journal_mode).toBe('delete');

    const lock = await holdWriteLock(dbPath, 400);
    const contender = makeStorage({ path: dbPath });
    const started = performance.now();
    await contender.setItem('seed', { value: 7, createdAt: 1 });
    // busy_timeout does not cover the switch: without the retry this fails within a millisecond.
    expect(performance.now() - started).toBeGreaterThanOrEqual(250);
    expect(await contender.getItem('seed')).toEqual({ value: 7, createdAt: 1 });
    expect(await lock.exited).toBe(0);
    expect((await queryDb<{ journal_mode: string }>(dbPath, 'PRAGMA journal_mode'))[0]!.journal_mode).toBe('wal');

    // A second process opening the WAL file while the lock is held again does not need the switch, so it does not wait.
    await contender.dispose();
    const again = await holdWriteLock(dbPath, 1_500);
    const reader = makeStorage({ path: dbPath });
    const reopened = performance.now();
    expect(await reader.getItem('seed')).toEqual({ value: 7, createdAt: 1 });
    expect(performance.now() - reopened).toBeLessThan(1_000);
    expect(await again.exited).toBe(0);
  });

  test('gives up on the WAL switch at the deadline, then fails fast until the cool-off ends and recovers', async () => {
    sqlCacheTuning.sqliteInitBusyTimeoutMs = 200;
    sqlCacheTuning.unavailableCooldownMs = 1_500;
    const dbPath = makeDbPath('wal-deadline.sqlite');
    await queryDb(dbPath, 'CREATE TABLE seed_check (x integer)');

    const lock = await holdWriteLock(dbPath, 700);
    const storage = makeStorage({ path: dbPath });
    await expect(storage.setItem('k', { value: 1, createdAt: 0 })).rejects.toThrow(/WAL mode within 200ms/);

    // The open is not attempted again on every call.
    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      await expect(storage.getItem('k')).rejects.toThrow(/failing fast/);
    }
    expect(performance.now() - started).toBeLessThan(1_000);

    expect(await lock.exited).toBe(0);
    await wait(1_600);
    await storage.setItem('k', { value: 1, createdAt: 0 });
    expect(await storage.getItem('k')).toEqual({ value: 1, createdAt: 0 });
  });

  test('a busy write lock fails a cache write quickly instead of stalling the event loop, while reads keep working', async () => {
    sqlCacheTuning.sqliteBusyTimeoutMs = 100;
    sqlCacheTuning.busyCooldownMs = 2_000;
    const dbPath = makeDbPath('busy.sqlite');
    const storage = makeStorage({ path: dbPath });
    const cache = new MochiCache({ storage, minTimeToStale: 60_000, maxTimeToLive: 120_000 });
    expect(await cache.fetch('warm', () => 'cached')).toBe('cached');

    const errors: { operation: string; message: string }[] = [];
    mochiEvents.on('cache:error', (e) => errors.push({ operation: e.operation, message: (e.error as Error).message }));
    let longestStall = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      longestStall = Math.max(longestStall, now - last);
      last = now;
    }, 5);

    const lock = await holdWriteLock(dbPath, 1_500);
    last = performance.now();
    const started = performance.now();
    // The write waits out the short busy timeout once, is reported, and the computed value is still returned.
    expect(await cache.fetch('contended', () => 'computed')).toBe('computed');
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.operation).toBe('set');
    expect(errors[0]!.message).toMatch(/locked|busy/i);

    // Until the cool-off ends further writes are refused without touching the lock; WAL reads never needed it.
    const burst = performance.now();
    for (let i = 0; i < 20; i++) {
      await expect(storage.setItem(`k${i}`, { value: i, createdAt: 0 })).rejects.toThrow(/failing fast/);
      expect(await cache.fetch('warm', () => 'never')).toBe('cached');
    }
    // Twenty writes each waiting out the lock would take two seconds.
    expect(performance.now() - burst).toBeLessThan(1_000);
    await wait(20);
    clearInterval(ticker);
    expect(longestStall).toBeLessThan(1_000);

    expect(await lock.exited).toBe(0);
    await wait(2_100);
    await storage.setItem('after', { value: 1, createdAt: 0 });
    expect(await storage.getItem('after')).toEqual({ value: 1, createdAt: 0 });
  });

  test('a background sweep that fails on the lock does not switch foreground caching off', async () => {
    sqlCacheTuning.sqliteBusyTimeoutMs = 50;
    sqlCacheTuning.busyCooldownMs = 5_000;
    const dbPath = makeDbPath('sweep-busy.sqlite');
    const storage = makeStorage({ path: dbPath, maxAge: 1 });
    await storage.setItem('old', { value: 1, createdAt: 0 });

    const lock = await holdWriteLock(dbPath, 300);
    await expect(storage.sweep(Date.now() + 1_000)).rejects.toThrow(/locked|busy/i);
    expect(await lock.exited).toBe(0);
    // Had the sweep tripped the gate, this write would be refused for the next five seconds.
    await storage.setItem('new', { value: 2, createdAt: 0 });
    expect(await storage.getItem('new')).toEqual({ value: 2, createdAt: 0 });
  });

  test('separate processes cold-booting on a brand-new file all succeed', async () => {
    const dbPath = makeDbPath('cold-boot.sqlite');
    const script = `const { SqliteStorage } = await import(process.argv[1]);
      const storage = new SqliteStorage({ path: process.argv[2], purgeInterval: 0 });
      try {
        await storage.setItem('k' + process.argv[3], { value: process.argv[3], createdAt: 0 });
        process.stdout.write('ok');
      } catch (err) {
        process.stdout.write('FAIL ' + err.message);
      }
      await storage.dispose();`;
    const procs = Array.from({ length: 8 }, (_, i) => Bun.spawn([process.execPath, '-e', script, storageModuleUrl, dbPath, String(i)], { stdout: 'pipe', stderr: 'pipe' }));
    const outputs = await Promise.all(procs.map((proc) => new Response(proc.stdout).text()));
    expect(outputs).toEqual(Array.from({ length: 8 }, () => 'ok'));

    const reader = makeStorage({ path: dbPath });
    expect(await reader.count()).toBe(8);
    expect(await queryDb(dbPath, 'SELECT id FROM mochi_migrations_cache')).toEqual([{ id: 1 }]);
  }, 30_000);
});
