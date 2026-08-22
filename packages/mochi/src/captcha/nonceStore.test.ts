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
  test('a nonce is consumable exactly once', () => {
    const store = sqliteStore(path.join(dir, 'once.sqlite'));
    expect(store.consume('a', future())).toBe(true);
    expect(store.consume('a', future())).toBe(false);
  });

  test('an expired nonce is pruned and consumable again', () => {
    const store = sqliteStore(path.join(dir, 'expired.sqlite'));
    expect(store.consume('a', Date.now() - 1)).toBe(true);
    expect(store.consume('a', future())).toBe(true);
  });

  test('seen nonces survive across store instances on the same file', () => {
    const file = path.join(dir, 'persist.sqlite');
    expect(sqliteStore(file).consume('a', future())).toBe(true);
    expect(sqliteStore(file).consume('a', future())).toBe(false);
  });

  // There is no background sweeper: pruning rides on consume. That's sound only
  // because a row can't appear without a consume, so the table stays bounded by
  // what was spent inside the expiry window rather than growing forever.
  test('expired rows are pruned by later consumes, so the table stays bounded', () => {
    const file = path.join(dir, 'bounded.sqlite');
    const store = sqliteStore(file);
    const db = new Database(file);
    const rows = () => (db.query('SELECT COUNT(*) AS n FROM nonces').get() as { n: number }).n;

    for (let i = 0; i < 50; i++) {
      store.consume(`expired-${i}`, Date.now() - 1);
    }
    store.consume('live', future());
    expect(rows()).toBe(1);
    db.close();
  });

  test('prunes via an index rather than scanning the table', () => {
    const file = path.join(dir, 'indexed.sqlite');
    sqliteStore(file);
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
