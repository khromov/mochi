// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../mochi-sql.d.ts" />
import { Database } from 'bun:sqlite';
import { parseMigrationSources } from '../migrations/loadMigrationFiles';
import { runMigrationSources } from '../migrations/runner';
import noncesMigration from './migrations/sqlite/1_nonces.sql' with { type: 'text' };
import type { NonceStore } from './types';

const MIGRATIONS_DIR = 'mochi-framework/src/captcha/migrations/sqlite';
const MIGRATIONS = [{ filename: '1_nonces.sql', contents: noncesMigration }];

export class MemoryNonceStore implements NonceStore {
  private seen = new Map<string, number>();

  consume(nonce: string, expiresAt: number): boolean {
    const now = Date.now();
    // Prune inline instead of on a timer — tokens expire in minutes and this
    // map only grows one entry per successful send, so the scan stays tiny.
    for (const [key, exp] of this.seen) {
      if (exp < now) {
        this.seen.delete(key);
      }
    }
    if (this.seen.has(nonce)) {
      return false;
    }
    this.seen.set(nonce, expiresAt);
    return true;
  }
}

export class SqliteNonceStore implements NonceStore {
  private db: Database;
  private path: string;
  private ready: Promise<unknown> | null = null;

  constructor(path: string) {
    this.path = path;
    this.db = new Database(path, { create: true });
  }

  private migrate(): Promise<unknown> {
    if (this.path === ':memory:' || this.path === '') {
      // A private in-memory database has no history to track, and the runner's own connection could never reach it.
      for (const migration of parseMigrationSources(MIGRATIONS_DIR, MIGRATIONS)) {
        this.db.run(migration.contents);
      }
      return Promise.resolve();
    }
    return runMigrationSources({ storage: { type: 'sqlite', path: this.path }, dir: MIGRATIONS_DIR, sources: MIGRATIONS, table: 'mochi_migrations_captcha', label: 'captcha' });
  }

  async consume(nonce: string, expiresAt: number): Promise<boolean> {
    // Migrated on first consume, not in the constructor, so the schema lands only in a store that is actually used.
    this.ready ??= this.migrate().catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    await this.ready;
    // Pruning rides on consume rather than a background sweeper: a row is only
    // ever added by a consume, so the table can't grow while nothing is calling
    // this. That makes it self-limiting — no timer to own or shut down.
    this.db.run('DELETE FROM nonces WHERE expires_at < ?', [Date.now()]);
    const result = this.db.run('INSERT OR IGNORE INTO nonces (nonce, expires_at) VALUES (?, ?)', [nonce, expiresAt]);
    return result.changes === 1;
  }

  // Release the underlying SQLite handle. Optional in production (the store lives
  // for the process), but Windows won't delete the DB file while a handle is open,
  // so tests must close before removing their temp dir.
  close(): void {
    this.db.close();
  }
}
