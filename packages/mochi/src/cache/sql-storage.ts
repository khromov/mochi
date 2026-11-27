import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Storage, SweepOptions, SweepResult } from './cache';
import { mochiEvents } from '../events';
import { clearInternalMigrationsCache, ensureInternalMigrations } from '../migrations/startup';
import { isValidStorage, storageKey, type MochiPostgresStorage, type MochiSqliteStorage, type MochiStorage } from '../migrations/storage';
import { isBuildingEntry } from '../utils/buildFlag';
import { pinGlobal } from '../utils/globalState';
import { logger } from '../utils/log';

interface SweeperOwner {
  stop(): void;
}

const sweeperOwners = pinGlobal('__mochi_cache_sweeper_owners__', () => new Map<string, SweeperOwner>());

// Signed 32-bit timer ceiling in Bun/Node; larger delays overflow `setInterval` and clamp to 1ms.
const MAX_TIMER_MS = 2_147_483_647;
const COMMON_OPTION_KEYS = new Set(['namespace', 'purgeOnInit', 'purgeInterval', 'maxAge']);

interface InlineBinary {
  __mochiBinary: string;
}

interface ValueEnvelope {
  __mochiValue: unknown;
}

function isInlineBinary(value: unknown): value is InlineBinary {
  return typeof value === 'object' && value !== null && typeof (value as { __mochiBinary?: unknown }).__mochiBinary === 'string' && Object.keys(value).length === 1;
}

function isValueEnvelope(value: unknown): value is ValueEnvelope {
  return typeof value === 'object' && value !== null && '__mochiValue' in value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function encodeInlineValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __mochiBinary: Buffer.from(value).toString('base64') } satisfies InlineBinary;
  }
  if (Array.isArray(value)) {
    return value.map(encodeInlineValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, k, { value: encodeInlineValue(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

function decodeInlineValue(value: unknown): unknown {
  if (isInlineBinary(value)) {
    return new Uint8Array(Buffer.from(value.__mochiBinary, 'base64'));
  }
  if (Array.isArray(value)) {
    return value.map(decodeInlineValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, k, { value: decodeInlineValue(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

function assertAllowedKeys(options: unknown, primaryKey: string, label: string): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return;
  }
  for (const key of Object.keys(options)) {
    if (key !== primaryKey && !COMMON_OPTION_KEYS.has(key)) {
      throw new Error(`${label}: unknown option "${key}".`);
    }
  }
}

interface CommonSqlStorageOptions {
  /** Logical keyspace isolating this cache from other `MochiCache` instances sharing the same database. Default `'default'`. */
  namespace?: string;
  /** Delete this namespace's existing entries before serving reads or writes. Default `false`. */
  purgeOnInit?: boolean;
  /** Background sweep interval (ms) that deletes expired entries in this namespace. Default `60_000`. `<= 0` disables the sweeper. */
  purgeInterval?: number;
  /** Entries older than this (ms) are deleted by `sweep()`. Should be `>=` the cache's `maxTimeToLive`. Default `600_000`. */
  maxAge?: number;
}

export interface SqliteStorageOptions extends CommonSqlStorageOptions {
  /** SQLite database file path. Created along with parent directories if missing. */
  path: string;
}

export interface PostgresStorageOptions extends CommonSqlStorageOptions {
  /** Postgres connection URL (`postgres://…` or `postgresql://…`). */
  url: string;
}

abstract class SqlCacheStorage implements Storage {
  protected readonly namespace: string;
  private readonly maxAge: number;
  private readonly purgeOnInit: boolean;
  private purgedOnInit = false;
  private sql?: SQL;
  private initPromise?: Promise<SQL>;
  private activeSweep?: Promise<void>;
  private disposePromise?: Promise<void>;
  private initialTimer?: ReturnType<typeof setTimeout>;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private sweepKey?: string;
  private sweepOwner?: SweeperOwner;
  private disposed = false;

  protected constructor(
    private readonly storageConfig: MochiStorage,
    private readonly table: string,
    private readonly label: string,
    options: CommonSqlStorageOptions,
  ) {
    const namespace = options.namespace ?? 'default';
    if (typeof namespace !== 'string' || namespace.trim().length === 0 || namespace.includes('\0')) {
      throw new Error(`${label}: namespace must be a non-empty string without null bytes.`);
    }
    const maxAge = options.maxAge ?? 600_000;
    if (typeof maxAge !== 'number' || Number.isNaN(maxAge) || maxAge <= 0) {
      throw new Error(`${label}: maxAge must be a positive number.`);
    }
    const purgeInterval = options.purgeInterval ?? 60_000;
    if (typeof purgeInterval !== 'number' || !Number.isFinite(purgeInterval)) {
      throw new Error(`${label}: purgeInterval must be a finite number (or <= 0 to disable).`);
    }
    if (options.purgeOnInit !== undefined && typeof options.purgeOnInit !== 'boolean') {
      throw new Error(`${label}: purgeOnInit must be a boolean.`);
    }

    this.namespace = namespace;
    this.maxAge = maxAge;
    this.purgeOnInit = options.purgeOnInit ?? false;

    // Skip timers when maxAge is Infinity (nothing ever expires) or while `mochi-framework build` / `migrate` inspects the entry.
    if (purgeInterval > 0 && Number.isFinite(maxAge) && !isBuildingEntry()) {
      this.startSweeper(Math.min(purgeInterval, MAX_TIMER_MS));
    }
  }

  protected abstract openSql(): Promise<SQL>;

  async getItem(key: string): Promise<unknown> {
    const sql = await this.ensureReady();
    const rows = (await sql.unsafe(`SELECT value FROM ${this.table} WHERE namespace = $1 AND key = $2`, [this.namespace, key])) as { value: string }[];
    const row = rows[0];
    if (!row) {
      return null;
    }
    const parsed = JSON.parse(row.value);
    if (!isValueEnvelope(parsed)) {
      return null;
    }
    return decodeInlineValue(parsed.__mochiValue);
  }

  async setItem(key: string, value: unknown): Promise<void> {
    const sql = await this.ensureReady();
    const envelope: ValueEnvelope = { __mochiValue: value === undefined ? null : encodeInlineValue(value) };
    const serialized = JSON.stringify(envelope);
    // Ascending `$1..$4` order is required by Bun's sqlite adapter, which binds array parameters positionally.
    await sql.unsafe(
      `INSERT INTO ${this.table} (namespace, key, value, written_at) VALUES ($1, $2, $3, $4) ` +
        `ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, written_at = excluded.written_at`,
      [this.namespace, key, serialized, Date.now()],
    );
  }

  async removeItem(key: string): Promise<void> {
    const sql = await this.ensureReady();
    await sql.unsafe(`DELETE FROM ${this.table} WHERE namespace = $1 AND key = $2`, [this.namespace, key]);
  }

  async clear(): Promise<void> {
    const sql = await this.ensureReady();
    await sql.unsafe(`DELETE FROM ${this.table} WHERE namespace = $1`, [this.namespace]);
  }

  async count(): Promise<number> {
    const sql = await this.ensureReady();
    const rows = (await sql.unsafe(`SELECT count(*) AS n FROM ${this.table} WHERE namespace = $1`, [this.namespace])) as { n: number | bigint | string }[];
    return Number(rows[0]?.n ?? 0);
  }

  async keys(): Promise<string[]> {
    const sql = await this.ensureReady();
    const rows = (await sql.unsafe(`SELECT key FROM ${this.table} WHERE namespace = $1`, [this.namespace])) as { key: string }[];
    return rows.map((row) => row.key);
  }

  async sweep(now: number = Date.now(), options: SweepOptions = {}): Promise<SweepResult> {
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new Error(`${this.label}.sweep(): now must be a finite timestamp.`);
    }
    if (!Number.isFinite(this.maxAge)) {
      return options.reportKeys ? { removed: 0, removedKeys: [] } : { removed: 0 };
    }
    const sql = await this.ensureReady();
    const cutoff = Math.floor(now - this.maxAge);
    if (options.reportKeys) {
      const rows = (await sql.unsafe(`DELETE FROM ${this.table} WHERE namespace = $1 AND written_at < $2 RETURNING key`, [this.namespace, cutoff])) as { key: string }[];
      return { removed: rows.length, removedKeys: rows.map((row) => row.key) };
    }
    const rows = (await sql.unsafe(`DELETE FROM ${this.table} WHERE namespace = $1 AND written_at < $2 RETURNING 1`, [this.namespace, cutoff])) as unknown[];
    return { removed: rows.length };
  }

  /** Stop the background sweep and close the underlying database connection. */
  dispose(): Promise<void> {
    this.disposed = true;
    this.stopSweepTimers();
    if (this.sweepKey !== undefined && sweeperOwners.get(this.sweepKey) === this.sweepOwner) {
      sweeperOwners.delete(this.sweepKey);
    }
    this.sweepKey = undefined;
    this.sweepOwner = undefined;
    clearInternalMigrationsCache(this.storageConfig);

    this.disposePromise ??= this.runDispose();
    return this.disposePromise;
  }

  private async runDispose(): Promise<void> {
    const pendingInit = this.initPromise;
    this.initPromise = undefined;
    if (pendingInit) {
      await pendingInit.catch(() => {});
    }
    if (this.activeSweep) {
      await this.activeSweep.catch(() => {});
    }
    const sql = this.sql;
    this.sql = undefined;
    if (sql) {
      await sql.close().catch(() => {});
    }
  }

  private ensureReady(): Promise<SQL> {
    if (this.disposed) {
      return Promise.reject(new Error(`${this.label} has been disposed.`));
    }
    if (!this.initPromise) {
      const attempt = this.init();
      this.initPromise = attempt;
      // Clear on transient boot/network failure so the next call retries instead of pinning a rejected promise forever.
      attempt.catch(() => {
        if (this.initPromise === attempt) {
          this.initPromise = undefined;
        }
      });
    }
    return this.initPromise;
  }

  private async init(): Promise<SQL> {
    await ensureInternalMigrations(this.storageConfig);
    if (this.disposed) {
      throw new Error(`${this.label} has been disposed.`);
    }
    const sql = await this.openSql();
    try {
      if (this.disposed) {
        throw new Error(`${this.label} has been disposed.`);
      }
      if (this.purgeOnInit && !this.purgedOnInit) {
        await sql.unsafe(`DELETE FROM ${this.table} WHERE namespace = $1`, [this.namespace]);
        if (this.disposed) {
          throw new Error(`${this.label} has been disposed.`);
        }
        this.purgedOnInit = true;
      }
      this.sql = sql;
      return sql;
    } catch (err) {
      await sql.close().catch(() => {});
      throw err;
    }
  }

  private stopSweepTimers(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
    this.initialTimer = undefined;
    this.intervalTimer = undefined;
  }

  private startSweeper(intervalMs: number): void {
    const run = async (): Promise<void> => {
      if (this.disposed || this.activeSweep) {
        return;
      }
      const start = Date.now();
      const task = (async () => {
        try {
          const { removed } = await this.sweep(start);
          if (!this.disposed) {
            mochiEvents.emit('cache:sweep', { removed, durationMs: Date.now() - start });
          }
        } catch (err) {
          if (!this.disposed) {
            logger.warn(`Cache sweep failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      })();
      this.activeSweep = task;
      try {
        await task;
      } finally {
        if (this.activeSweep === task) {
          this.activeSweep = undefined;
        }
      }
    };

    // Keyed per (database, namespace) so HMR reloads replace dead sweepers while distinct namespaces keep their own maxAge schedule.
    const key = `${storageKey(this.storageConfig)}\0${this.namespace}`;
    sweeperOwners.get(key)?.stop();
    this.sweepKey = key;
    this.sweepOwner = { stop: () => this.stopSweepTimers() };

    this.initialTimer = setTimeout(run, 1_000);
    this.intervalTimer = setInterval(run, intervalMs);
    this.initialTimer.unref?.();
    this.intervalTimer.unref?.();
    sweeperOwners.set(key, this.sweepOwner);
  }
}

/**
 * SQLite-backed `Storage` for {@link MochiCache}. Applies Mochi's internal SQLite migrations (`mochi_cache`) on first
 * access, runs in WAL mode, and isolates keys by `namespace` (default `'default'`) so multiple caches can share one `.db` file.
 */
export class SqliteStorage extends SqlCacheStorage {
  private readonly filePath: string;

  constructor(options: SqliteStorageOptions) {
    assertAllowedKeys(options, 'path', 'SqliteStorage');
    const trimmedPath = typeof options?.path === 'string' ? options.path.trim() : (options?.path as unknown as string);
    const storageConfig: MochiSqliteStorage = { type: 'sqlite', path: trimmedPath };
    if (!isValidStorage(storageConfig)) {
      throw new Error('SqliteStorage: expected a non-empty file `path` (":memory:" and "?" URI query strings are not supported; use MemoryStorage for in-memory caching).');
    }
    super(storageConfig, 'mochi_cache', 'SqliteStorage', options);
    this.filePath = resolve(trimmedPath);
  }

  protected async openSql(): Promise<SQL> {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const sql = new SQL({ adapter: 'sqlite', filename: this.filePath });
    try {
      // Set busy_timeout before switching journal_mode so a concurrent startup write lock waits instead of failing at 0ms.
      await sql.unsafe('PRAGMA busy_timeout = 30000');
      await sql.unsafe('PRAGMA journal_mode = WAL');
      return sql;
    } catch (err) {
      await sql.close().catch(() => {});
      throw err;
    }
  }
}

/**
 * Postgres-backed `Storage` for {@link MochiCache}. Applies Mochi's internal Postgres migrations (`mochi_cache.entries`)
 * on first access and isolates keys by `namespace` (default `'default'`) so multiple caches and server replicas can share one database.
 */
export class PostgresStorage extends SqlCacheStorage {
  private readonly url: string;

  constructor(options: PostgresStorageOptions) {
    assertAllowedKeys(options, 'url', 'PostgresStorage');
    const trimmedUrl = typeof options?.url === 'string' ? options.url.trim() : (options?.url as unknown as string);
    const storageConfig: MochiPostgresStorage = { type: 'postgres', url: trimmedUrl };
    if (!isValidStorage(storageConfig)) {
      throw new Error('PostgresStorage: expected a `postgres://` or `postgresql://` connection `url`.');
    }
    super(storageConfig, 'mochi_cache.entries', 'PostgresStorage', options);
    this.url = trimmedUrl;
  }

  protected async openSql(): Promise<SQL> {
    // Unnamed statements work behind transaction-mode poolers (PgBouncer/Neon) and PGlite's single-session test socket.
    return new SQL({ adapter: 'postgres', url: this.url, prepare: false });
  }
}
