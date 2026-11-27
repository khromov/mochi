import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { MemoryNonceStore, SqliteNonceStore } from './nonceStore';

const dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-nonce-test-'));

// Track every SqliteNonceStore so afterAll can close its handle before removing
// the temp dir — Windows refuses to delete a DB file while a handle is open.
const stores: SqliteNonceStore[] = [];
function sqliteStore(file: string): SqliteNonceStore {
  const store = new SqliteNonceStore(file);
  stores.push(store);
  return store;
}

afterAll(() => {
  for (const store of stores) {
    store.close();
  }
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
  test('a nonce is consumable exactly once', async () => {
    const store = sqliteStore(path.join(dir, 'once.sqlite'));
    expect(await store.consume('a', future())).toBe(true);
    expect(await store.consume('a', future())).toBe(false);
  });

  test('an expired nonce is pruned and consumable again', async () => {
    const store = sqliteStore(path.join(dir, 'expired.sqlite'));
    expect(await store.consume('a', Date.now() - 1)).toBe(true);
    expect(await store.consume('a', future())).toBe(true);
  });

  test('seen nonces survive across store instances on the same file', async () => {
    const file = path.join(dir, 'persist.sqlite');
    expect(await sqliteStore(file).consume('a', future())).toBe(true);
    expect(await sqliteStore(file).consume('a', future())).toBe(false);
  });

  // There is no background sweeper: pruning rides on consume. That's sound only
  // because a row can't appear without a consume, so the table stays bounded by
  // what was spent inside the expiry window rather than growing forever.
  test('expired rows are pruned by later consumes, so the table stays bounded', async () => {
    const file = path.join(dir, 'bounded.sqlite');
    const store = sqliteStore(file);
    const db = new Database(file);
    const rows = () => (db.query('SELECT COUNT(*) AS n FROM nonces').get() as { n: number }).n;

    for (let i = 0; i < 50; i++) {
      await store.consume(`expired-${i}`, Date.now() - 1);
    }
    await store.consume('live', future());
    expect(rows()).toBe(1);
    db.close();
  });

  test('prunes via an index rather than scanning the table', async () => {
    const file = path.join(dir, 'indexed.sqlite');
    await sqliteStore(file).consume('a', future());
    const db = new Database(file);
    const plan = db
      .query('EXPLAIN QUERY PLAN DELETE FROM nonces WHERE expires_at < ?')
      .all(Date.now())
      .map((r) => (r as { detail: string }).detail)
      .join(' ');
    expect(plan).toContain('USING INDEX nonces_expires_at');
    expect(plan).not.toContain('SCAN nonces');
    db.close();
  });
});

describe('SqliteNonceStore migrations', () => {
  const tables = (file: string) => {
    const db = new Database(file);
    const names = (db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );
    db.close();
    return names;
  };
  const tracked = (file: string) => {
    const db = new Database(file);
    const rows = db.query('SELECT id, name FROM mochi_migrations_captcha ORDER BY id').all();
    db.close();
    return rows;
  };

  test('applies its schema to its own file on first consume, tracked in mochi_migrations_captcha', async () => {
    const file = path.join(dir, 'lazy.sqlite');
    const store = sqliteStore(file);
    expect(tables(file)).toEqual([]);

    expect(await store.consume('a', future())).toBe(true);
    expect(tables(file)).toEqual(['mochi_migrations_captcha', 'nonces', 'nonces_expires_at']);
    expect(tracked(file)).toEqual([{ id: 1, name: 'nonces' }]);
  });

  test('adopts a nonce file created by the pre-migration store without losing its rows', async () => {
    const file = path.join(dir, 'legacy.sqlite');
    const legacy = new Database(file, { create: true });
    // The exact DDL the store ran inline before it moved to migrations.
    legacy.run('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
    legacy.run('CREATE INDEX IF NOT EXISTS nonces_expires_at ON nonces (expires_at)');
    legacy.run('INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)', ['spent', future()]);
    legacy.close();

    const store = sqliteStore(file);
    expect(await store.consume('spent', future())).toBe(false);
    expect(await store.consume('fresh', future())).toBe(true);
    expect(tracked(file)).toEqual([{ id: 1, name: 'nonces' }]);
  });

  test('surfaces a migration failure on every consume instead of caching it', async () => {
    const file = path.join(dir, 'tampered.sqlite');
    await sqliteStore(file).consume('a', future());
    const db = new Database(file);
    db.run("UPDATE mochi_migrations_captcha SET hash = 'x'");
    db.close();

    const store = sqliteStore(file);
    await expect(store.consume('b', future())).rejects.toThrow('changed since it was applied');
    await expect(store.consume('b', future())).rejects.toThrow('changed since it was applied');
  });

  test('a :memory: store gets the schema without a tracking table', async () => {
    const store = sqliteStore(':memory:');
    expect(await store.consume('a', future())).toBe(true);
    expect(await store.consume('a', future())).toBe(false);
  });

  test('concurrent cold starts on one file apply the migration once and burn a shared nonce once', async () => {
    const file = path.join(dir, 'race.sqlite');
    const child = path.join(dir, 'race-child.ts');
    // The store's own handle sets no busy timeout, so a write that collides with a sibling's is retried here.
    await Bun.write(
      child,
      `import { SqliteNonceStore } from ${JSON.stringify(path.join(import.meta.dir, 'nonceStore.ts'))};
const startAt = Number(process.argv[2]);
while (Date.now() < startAt) {}
const store = new SqliteNonceStore(${JSON.stringify(file)});
for (;;) {
  try {
    console.log(await store.consume('shared', Date.now() + 60_000));
    break;
  } catch (err) {
    if (!String(err).includes('database is locked')) throw err;
  }
}
store.close();
`,
    );
    const startAt = Date.now() + 2000;
    const procs = Array.from({ length: 6 }, () => Bun.spawn([process.execPath, child, String(startAt)], { stdout: 'pipe', stderr: 'pipe' }));
    const results = await Promise.all(
      procs.map(async (proc) => ({ out: (await new Response(proc.stdout).text()).trim(), err: await new Response(proc.stderr).text(), code: await proc.exited })),
    );

    expect(results.map((r) => r.err).filter(Boolean)).toEqual([]);
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(results.filter((r) => r.out === 'true')).toHaveLength(1);
    expect(tracked(file)).toEqual([{ id: 1, name: 'nonces' }]);
  }, 30_000);

  test('still migrates when bundled away from its source tree', async () => {
    const entry = path.join(dir, 'bundle-entry.ts');
    await Bun.write(entry, `export { SqliteNonceStore } from ${JSON.stringify(path.join(import.meta.dir, 'nonceStore.ts'))};\n`);
    const outdir = path.join(dir, 'bundle-out');
    const result = await Bun.build({ entrypoints: [entry], outdir, target: 'bun' });
    expect(result.success).toBe(true);
    expect(await Bun.file(path.join(outdir, 'bundle-entry.js')).text()).toContain('CREATE TABLE IF NOT EXISTS nonces');

    const { SqliteNonceStore: Bundled } = (await import(path.join(outdir, 'bundle-entry.js'))) as { SqliteNonceStore: typeof SqliteNonceStore };
    const file = path.join(dir, 'bundled.sqlite');
    const store = new Bundled(file);
    try {
      expect(await store.consume('a', future())).toBe(true);
      expect(tracked(file)).toEqual([{ id: 1, name: 'nonces' }]);
    } finally {
      store.close();
    }
  });
});
