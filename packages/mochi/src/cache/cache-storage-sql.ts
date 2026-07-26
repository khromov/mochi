import type { Storage, SweepOptions, SweepResult } from './cache';
import { createSqlDriver, timestampColumn, toNumber, type SqlDriver } from '../sql/driver';
import { assertNoPurgeInterval, registerSweepable, unregisterSweepable, type SweepableStorage } from './sweepRegistry';
import { mochiEvents } from '../events';

/** On-disk sentinel for a binary field: the bytes inlined as base64. Shared wire format with `FileStorage`. */
interface InlineBinary {
  __mochiBinary: string;
}

function isInlineBinary(value: unknown): value is InlineBinary {
  return typeof value === 'object' && value !== null && typeof (value as { __mochiBinary?: unknown }).__mochiBinary === 'string';
}

// Buffer extends Uint8Array, so this covers both.
function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

// Deep-clone `value`, inlining binaries as base64. `SqlStorage` has no equivalent of
// FileStorage's blob offloading — a row is a row — so this is the only encoding.
function encodeBinaries(value: unknown): unknown {
  if (isBinary(value)) {
    return { __mochiBinary: Buffer.from(value).toString('base64') } satisfies InlineBinary;
  }
  if (Array.isArray(value)) {
    return value.map(encodeBinaries);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodeBinaries(v);
    }
    return out;
  }
  return value;
}

function decodeBinaries(value: unknown): unknown {
  if (isInlineBinary(value)) {
    return new Uint8Array(Buffer.from(value.__mochiBinary, 'base64'));
  }
  if (Array.isArray(value)) {
    return value.map(decodeBinaries);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decodeBinaries(v);
    }
    return out;
  }
  return value;
}

export interface SqlStorageOptions {
  /**
   * Connection string. `sqlite://./data/cache.db` (or a bare path ending in
   * `.db`/`.sqlite`) uses `bun:sqlite`; `postgres://…` uses `Bun.SQL`. MySQL is
   * rejected — see `sql/driver.ts`.
   */
  url: string;
  /** Table name. Default `mochi_cache`. Interpolated into DDL, so it must be a plain identifier. */
  table?: string;
  /** Rows older than this (ms) are deleted by `sweep()`. Should be `>=` the cache's `maxTimeToLive`. Default `600_000`. */
  maxAge?: number;
  /** Let the `mochi:cache-sweep` task delete expired rows. Default `true`. Set `false` to drive `sweep()` yourself. */
  purge?: boolean;
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Persists each cache entry as one row, so several processes can share a cache
 * over SQLite on a common volume or over Postgres across hosts. The entry's own
 * `createdAt` still drives stale-while-revalidate — this backend only stores and
 * returns values, exactly like `MemoryStorage` and `FileStorage`.
 *
 * Values round-trip through JSON, with `Uint8Array`/`Buffer` fields inlined as
 * base64 (the same `__mochiBinary` sentinel `FileStorage` writes) and decoded back
 * to `Uint8Array` on read. There is no blob-offload equivalent: a large binary
 * lands in the row itself, so prefer `FileStorage` for image-sized payloads.
 *
 * Schema setup is lazy and idempotent (`CREATE TABLE IF NOT EXISTS`), run once on
 * the first operation, so constructing the adapter never blocks.
 */
export class SqlStorage implements Storage, SweepableStorage {
  private driver: SqlDriver;
  private table: string;
  private maxAge: number;
  private ready?: Promise<void>;

  constructor(options: SqlStorageOptions) {
    assertNoPurgeInterval(options, 'SqlStorage');
    this.table = options.table ?? 'mochi_cache';
    if (!IDENTIFIER.test(this.table)) {
      throw new Error(`SqlStorage: table name "${this.table}" is not a plain SQL identifier.`);
    }
    this.maxAge = options.maxAge ?? 600_000;
    this.driver = createSqlDriver(options.url);

    if (options.purge !== false) {
      registerSweepable(this);
    }
  }

  async getItem(key: string): Promise<unknown> {
    await this.init();
    const rows = await this.driver.query<{ value: string }>(`SELECT value FROM ${this.table} WHERE key = $key`, { key });
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    try {
      return decodeBinaries(JSON.parse(row.value));
    } catch {
      // A row we can't parse is treated as a miss and overwritten by the next
      // recompute, matching FileStorage's handling of a corrupt file.
      return null;
    }
  }

  async setItem(key: string, value: unknown): Promise<void> {
    await this.init();
    await this.driver.query(
      `INSERT INTO ${this.table} (key, value, written_at) VALUES ($key, $value, $writtenAt)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, written_at = excluded.written_at`,
      { key, value: JSON.stringify(encodeBinaries(value)), writtenAt: Date.now() },
    );
  }

  async removeItem(key: string): Promise<void> {
    await this.init();
    await this.driver.query(`DELETE FROM ${this.table} WHERE key = $key`, { key });
  }

  async clear(): Promise<void> {
    await this.init();
    await this.driver.query(`DELETE FROM ${this.table}`);
  }

  async count(): Promise<number> {
    await this.init();
    const rows = await this.driver.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM ${this.table}`);
    return toNumber(rows[0]?.n) ?? 0;
  }

  async keys(): Promise<string[]> {
    await this.init();
    const rows = await this.driver.query<{ key: string }>(`SELECT key FROM ${this.table}`);
    return rows.map((row) => row.key);
  }

  /** Delete rows older than `maxAge`. `reportKeys` also returns the keys removed. */
  async sweep(now: number = Date.now(), options: SweepOptions = {}): Promise<SweepResult> {
    await this.init();
    const rows = await this.driver.query<{ key: string }>(`DELETE FROM ${this.table} WHERE written_at < $cutoff RETURNING key`, { cutoff: now - this.maxAge });
    return options.reportKeys ? { removed: rows.length, removedKeys: rows.map((r) => r.key) } : { removed: rows.length };
  }

  /** Detach from the shared sweep and release the connection. Call when the store is no longer needed (e.g. in tests). */
  async dispose(): Promise<void> {
    // Unregister first: the janitor must not reach a driver this is about to close.
    unregisterSweepable(this);
    await this.driver.close();
  }

  // Memoized so concurrent first-callers share one CREATE TABLE rather than racing it.
  private init(): Promise<void> {
    this.ready ??= (async () => {
      const ts = timestampColumn(this.driver.dialect);
      await this.driver.query(`CREATE TABLE IF NOT EXISTS ${this.table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, written_at ${ts} NOT NULL)`);
      await this.driver.query(`CREATE INDEX IF NOT EXISTS ${this.table}_written_at ON ${this.table} (written_at)`);
    })();
    return this.ready;
  }

  async sweepAndReport(): Promise<void> {
    const start = Date.now();
    try {
      const { removed } = await this.sweep(start);
      mochiEvents.emit('cache:sweep', { removed, durationMs: Date.now() - start });
    } catch (error) {
      mochiEvents.emit('cache:error', { key: '(sweep)', operation: 'remove', error });
    }
  }
}
