import { SQL } from 'bun';
import path from 'node:path';
import { parse, stringify } from 'devalue';
import { pinGlobal } from './utils/globalState';
import { getMochiConfig } from './mochiConfig';
import { logger } from './utils/log';
import { STORAGE_SHAPE_HINT, isValidStorageObject, openSqliteFile } from './utils/storageConfig';
// Type-only so bun-boss (queue.ts's runtime dep) never lands in a bundle that only uses options.
import type { PGliteLike } from './queue';

/**
 * Where options live: a SQLite file, a Postgres database (a `mochi_options` schema), or a caller-owned embedded
 * PGlite instance (Mochi never closes it) — always persistent, deliberately no memory backend.
 */
export type MochiOptionsStorage = { sqlite: string } | { postgres: string } | { pglite: PGliteLike };

export function assertValidOptionsStorage(storage: unknown, context: string): asserts storage is MochiOptionsStorage {
  // `{ sqlite: ':memory:' }` would silently reach openSqliteFile's memory special case, so it gets the same teaching error as the literal 'memory'.
  const memory = storage === 'memory' || (typeof storage === 'object' && storage !== null && (storage as { sqlite?: unknown }).sqlite === ':memory:');
  if (memory) {
    throw new Error(`${context}: options have no memory backend — the options store exists to persist across restarts. Use ${STORAGE_SHAPE_HINT}.`);
  }
  if (!isValidStorageObject(storage)) {
    throw new Error(`${context}: expected ${STORAGE_SHAPE_HINT}.`);
  }
}

// Drivers deal in already-serialized strings; devalue stays in the public layer.
interface OptionsDriver {
  get(key: string): Promise<string | undefined>;
  getVersioned(key: string): Promise<{ serialized: string; version: number } | undefined>;
  /** Race-safe insert-only via ON CONFLICT; `false` = the key already existed, nothing written. */
  insert(key: string, serialized: string, now: number): Promise<boolean>;
  upsert(key: string, serialized: string, now: number): Promise<void>;
  /** Writes only if the row's version still matches; `false` = another writer landed first. */
  updateVersioned(key: string, serialized: string, expectedVersion: number, now: number): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  close(): Promise<void>;
}

type SqlExecutor = (text: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

const SQLITE_DDL =
  'CREATE TABLE IF NOT EXISTS mochi_options (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)';

const POSTGRES_DDL = [
  'CREATE SCHEMA IF NOT EXISTS mochi_options',
  'CREATE TABLE IF NOT EXISTS mochi_options.options (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)',
];

// Fresh rows start at a random version so a delete+recreate can never resurrect a version an in-flight modify()
// already observed — its optimistic check would otherwise ABA-match and silently drop the recreated value.
const newVersion = () => Math.floor(Math.random() * 2 ** 30);

// One statement set for all three backends; the dialects differ only in table name and how the upsert's SET
// expression must reference the existing row's version (Postgres qualifies it against the schema-local table name).
// Placeholders must appear in ascending numeric order: Bun's sqlite adapter binds an array by appearance, not by $n.
function createSqlDriver(executor: SqlExecutor, table: string, versionRef: string, close: () => Promise<void>): OptionsDriver {
  return {
    async get(key) {
      const rows = (await executor(`SELECT value FROM ${table} WHERE key = $1`, [key])) as Array<{ value: string }>;
      return rows[0]?.value;
    },
    async getVersioned(key) {
      const rows = (await executor(`SELECT value, version FROM ${table} WHERE key = $1`, [key])) as Array<{ value: string; version: number }>;
      return rows[0] ? { serialized: rows[0].value, version: rows[0].version } : undefined;
    },
    async insert(key, serialized, now) {
      const rows = await executor(`INSERT INTO ${table} (key, value, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING RETURNING key`, [
        key,
        serialized,
        newVersion(),
        now,
        now,
      ]);
      return rows.length === 1;
    },
    async upsert(key, serialized, now) {
      await executor(
        `INSERT INTO ${table} (key, value, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) ` +
          `ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, version = ${versionRef} + 1`,
        [key, serialized, newVersion(), now, now],
      );
    },
    async updateVersioned(key, serialized, expectedVersion, now) {
      const rows = await executor(`UPDATE ${table} SET value = $1, version = version + 1, updated_at = $2 WHERE key = $3 AND version = $4 RETURNING key`, [
        serialized,
        now,
        key,
        expectedVersion,
      ]);
      return rows.length === 1;
    },
    async delete(key) {
      const rows = await executor(`DELETE FROM ${table} WHERE key = $1 RETURNING key`, [key]);
      return rows.length === 1;
    },
    close,
  };
}

async function createSqliteDriver(file: string): Promise<OptionsDriver> {
  const sql = openSqliteFile(file);
  try {
    await sql.unsafe(SQLITE_DDL);
  } catch (err) {
    await sql.close().catch(() => {});
    throw err;
  }
  return createSqlDriver(
    (text, params) => sql.unsafe(text, params) as Promise<Array<Record<string, unknown>>>,
    'mochi_options',
    'version',
    () => sql.close(),
  );
}

async function createPostgresDriver(url: string): Promise<OptionsDriver> {
  const sql = new SQL(url);
  try {
    for (const statement of POSTGRES_DDL) {
      await sql.unsafe(statement);
    }
  } catch (err) {
    await sql.close().catch(() => {});
    throw err;
  }
  return createSqlDriver(
    (text, params) => sql.unsafe(text, params) as Promise<Array<Record<string, unknown>>>,
    'mochi_options.options',
    'options.version',
    () => sql.close(),
  );
}

async function createPgliteDriver(instance: PGliteLike): Promise<OptionsDriver> {
  // Statements must go through bun-boss's adapter: its per-instance lock keeps an options write from interleaving
  // with (and being rolled back by) an open queue transaction on the single connection. That lock lives at bun-boss
  // module scope, so prefer the queue module's globally-pinned copy — an SSR-bundled copy of this file importing
  // 'bun-boss' itself would create a second, disjoint lock domain. The fallback (options without the queue module
  // loaded) has no queue lock to share; the lazy import keeps bun-boss out of options-only bundles.
  const shared = (globalThis as unknown as Record<string, unknown>).__mochi_bun_boss__ as Pick<typeof import('bun-boss'), 'fromPglite'> | undefined;
  const { fromPglite } = shared ?? (await import('bun-boss'));
  const db = fromPglite(instance);
  await db.executeSql(POSTGRES_DDL.join('; '));
  return createSqlDriver(
    async (text, params) => (await db.executeSql(text, params)).rows as Array<Record<string, unknown>>,
    'mochi_options.options',
    'options.version',
    // The caller constructs and owns the PGlite instance (same contract as queue storage), so there is nothing to close.
    async () => {},
  );
}

function createDriver(storage: MochiOptionsStorage): Promise<OptionsDriver> {
  if ('sqlite' in storage) {
    return createSqliteDriver(storage.sqlite);
  }
  if ('pglite' in storage) {
    return createPgliteDriver(storage.pglite);
  }
  return createPostgresDriver(storage.postgres);
}

interface OptionsRegistry {
  initPromise: Promise<OptionsDriver> | null;
  storage: MochiOptionsStorage | null;
}

const registry = pinGlobal<OptionsRegistry>('__mochi_options_registry__', () => ({
  initPromise: null,
  storage: null,
}));

function sameStorage(a: MochiOptionsStorage | null, b: MochiOptionsStorage | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if ('sqlite' in a) {
    return 'sqlite' in b && path.resolve(a.sqlite) === path.resolve(b.sqlite);
  }
  if ('postgres' in a) {
    return 'postgres' in b && a.postgres === b.postgres;
  }
  return 'pglite' in b && a.pglite === b.pglite;
}

/** Registers where MochiOptions connects on first use — called by Mochi.serve({ optionsStorage }) at boot, and directly by tests. Pass `null` to clear. */
export function initOptionsStorage(storage: MochiOptionsStorage | null): void {
  if (storage !== null) {
    assertValidOptionsStorage(storage, 'initOptionsStorage()');
  }
  const previous = registry.storage;
  registry.storage = storage;
  // A reconfigure (or a clear) must also drop the cached driver, or reads would keep hitting the previous storage.
  if (registry.initPromise && !sameStorage(previous, storage)) {
    void closeOptionsStorage();
  }
}

function resolveStorage(method: string, key: string): MochiOptionsStorage {
  if (registry.storage) {
    return registry.storage;
  }
  try {
    getMochiConfig();
  } catch {
    throw new Error(
      `MochiOptions.${method}("${key}"): Mochi.serve() has not been called yet. Options become available once Mochi.serve({ optionsStorage }) runs — ` +
        `in a standalone worker process, pass optionsStorage to Mochi.worker().`,
    );
  }
  throw new Error(`MochiOptions.${method}("${key}"): no optionsStorage is configured. Pass optionsStorage to Mochi.serve() — ${STORAGE_SHAPE_HINT} — to enable the options store.`);
}

async function requireDriver(method: string, key: string): Promise<OptionsDriver> {
  if (!registry.initPromise) {
    const init = createDriver(resolveStorage(method, key));
    registry.initPromise = init;
    // Cleared on rejection so the next call retries the connection instead of replaying a cached dead promise.
    init.catch(() => {
      if (registry.initPromise === init) {
        registry.initPromise = null;
      }
    });
  }
  return registry.initPromise;
}

/** Full teardown for stop paths: forget the registration first (so a straggling call can't lazily reopen a driver nothing will close), then close. */
export async function shutdownOptionsStorage(): Promise<void> {
  registry.storage = null;
  await closeOptionsStorage();
}

/** Idempotent, never throws — safe on every stop path and in test afterEach. */
export async function closeOptionsStorage(): Promise<void> {
  const pending = registry.initPromise;
  registry.initPromise = null;
  if (!pending) {
    return;
  }
  // An in-flight first call may still be opening the handle; settle it so the close below reaches it.
  const driver = await pending.catch(() => null);
  if (!driver) {
    return;
  }
  try {
    await driver.close();
  } catch (err) {
    logger.warn(`MochiOptions storage close failed: ${err instanceof Error ? err.message : err}`);
  }
}

// Progress is guaranteed (every lost race means another writer won), so exhaustion signals pathological contention.
const MODIFY_MAX_ATTEMPTS = 20;

function assertKey(method: string, key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(`MochiOptions.${method}(): key must be a non-empty string.`);
  }
}

function assertValue(method: string, key: string, value: unknown): void {
  if (value === undefined) {
    throw new Error(`MochiOptions.${method}("${key}"): value must not be undefined — get() returns undefined for a missing key. ` + `Store null instead, or delete() the key.`);
  }
}

/**
 * A persistent key/value store for small app data, backed by `Mochi.serve({ optionsStorage })` and connected lazily
 * on the first call. Values are devalue-serialized (rich types like `Date`, `Map`, `BigInt` survive); reads are
 * never cached.
 */
export interface MochiOptionsApi {
  /** Resolves the stored value, or `undefined` when the key is missing. A stored `null` is a hit. */
  get(key: string): Promise<unknown>;
  // The untyped overload above keeps a bare `get(key)` at `unknown` — an unresolved `T` nested in another generic
  // call (e.g. `expect()`) collapses to `undefined` during inference.
  get<T>(key: string): Promise<T | undefined>;
  /** Resolves the stored value, or `fallback` on a miss. The fallback is returned, never written. */
  get<T>(key: string, fallback: T): Promise<T>;
  /** Insert-only: throws if the key already exists. Use `update()` to overwrite. */
  set(key: string, value: unknown): Promise<void>;
  /** Upsert: insert or overwrite. */
  update(key: string, value: unknown): Promise<void>;
  /** Atomic read-modify-write; re-runs `fn` (which must be pure) when another writer lands in between, and resolves the written value. */
  modify<T = unknown>(key: string, fn: (current: T | undefined) => T | Promise<T>): Promise<T>;
  /** Resolves `true` when the key existed and was removed, `false` when there was nothing to remove. */
  delete(key: string): Promise<boolean>;
}

async function getOption(key: string, fallback?: unknown): Promise<unknown> {
  assertKey('get', key);
  const driver = await requireDriver('get', key);
  const serialized = await driver.get(key);
  if (serialized === undefined) {
    return fallback;
  }
  return parse(serialized);
}

export const MochiOptions: MochiOptionsApi = {
  get: getOption as MochiOptionsApi['get'],
  async set(key, value) {
    assertKey('set', key);
    assertValue('set', key, value);
    const driver = await requireDriver('set', key);
    const inserted = await driver.insert(key, stringify(value), Date.now());
    if (!inserted) {
      throw new Error(`MochiOptions.set("${key}"): the key already exists. set() is insert-only — use MochiOptions.update() to overwrite, or delete() it first.`);
    }
  },
  async update(key, value) {
    assertKey('update', key);
    assertValue('update', key, value);
    const driver = await requireDriver('update', key);
    await driver.upsert(key, stringify(value), Date.now());
  },
  async modify(key, fn) {
    assertKey('modify', key);
    if (typeof fn !== 'function') {
      throw new Error(`MochiOptions.modify("${key}"): the second argument must be a function (current) => next.`);
    }
    const driver = await requireDriver('modify', key);
    for (let attempt = 0; attempt < MODIFY_MAX_ATTEMPTS; attempt++) {
      const row = await driver.getVersioned(key);
      const next = await fn(row === undefined ? undefined : parse(row.serialized));
      assertValue('modify', key, next);
      const serialized = stringify(next);
      const written = row === undefined ? await driver.insert(key, serialized, Date.now()) : await driver.updateVersioned(key, serialized, row.version, Date.now());
      if (written) {
        return next;
      }
      // Jittered backoff: a hot-key burst has exactly one winner per round, so spreading the losers keeps the attempt cap out of reach.
      await Bun.sleep(Math.random() * Math.min(2 ** attempt, 50));
    }
    throw new Error(`MochiOptions.modify("${key}"): gave up after ${MODIFY_MAX_ATTEMPTS} attempts — concurrent writers kept changing the key.`);
  },
  async delete(key) {
    assertKey('delete', key);
    const driver = await requireDriver('delete', key);
    return driver.delete(key);
  },
};
