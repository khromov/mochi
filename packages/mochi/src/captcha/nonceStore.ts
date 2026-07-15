import { Database } from 'bun:sqlite';
import type { NonceStore } from './types';

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

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
  }

  consume(nonce: string, expiresAt: number): boolean {
    this.db.run('DELETE FROM nonces WHERE expires_at < ?', [Date.now()]);
    const result = this.db.run('INSERT OR IGNORE INTO nonces (nonce, expires_at) VALUES (?, ?)', [nonce, expiresAt]);
    return result.changes === 1;
  }
}
