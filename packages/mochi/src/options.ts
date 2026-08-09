import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'devalue';
import { pinGlobal } from './utils/globalState';
import { getMochiConfig } from './mochiConfig';
import { logger } from './utils/log';
// Type-only so bun-boss (queue.ts's runtime dep) never lands in a bundle that only uses options.
import type { PGliteLike } from './queue';

/**
 * Where options live: a SQLite file, a Postgres database (a `mochi_options` schema), or a caller-owned embedded
 * PGlite instance (Mochi never closes it) — always persistent, deliberately no memory backend.
 */
export type MochiOptionsStorage = { sqlite: string } | { postgres: string } | { pglite: PGliteLike };

const storageChecks: Record<string, (value: unknown) => boolean> = {
  sqlite: (value) => typeof value === 'string' && value.length > 0,
  postgres: (value) => typeof value === 'string' && value.length > 0,
  pglite: (value) => {
    const instance = value as Partial<PGliteLike> | null;
    return typeof instance === 'object' && instance !== null && typeof instance.query === 'function' && typeof instance.exec === 'function';
  },
};

/** Runtime-validates what the types already promise, because `optionsStorage` often arrives from untyped config. */
export function isValidOptionsStorage(storage: MochiOptionsStorage): boolean {
  if (typeof storage !== 'object' || storage === null) {
    return false;
  }
  const [entry, ...extra] = Object.entries(storageChecks).filter(([key]) => key in storage);
  if (!entry || extra.length > 0) {
    return false;
  }
  const [key, check] = entry;
  return check((storage as unknown as Record<string, unknown>)[key]);
}

// Drivers deal in already-serialized strings; devalue stays in the public layer.
interface OptionsDriver {
  get(key: string): Promise<string | undefined>;
  getVersioned(key: string): Promise<{ serialized: string; version: number } | undefined>;
  /** Race-safe insert-only via ON CONFLICT; `false` = the key already existed, nothing written. */
  insert(key: string, serialized: string, now: number): Promise<boolean>;
  /** Upsert; preserves `created_at`, bumps `updated_at` and `version`. */
  upsert(key: string, serialized: string, now: number): Promise<void>;
  /** Writes only if the row's version still matches; `false` = another writer landed first. */
  updateVersioned(key: string, serialized: string, expectedVersion: number, now: number): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  close(): Promise<void>;
}

async function createSqliteDriver(file: string): Promise<OptionsDriver> {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sql = new SQL(`sqlite://${file}`);
  try {
    await sql.unsafe(
      'CREATE TABLE IF NOT EXISTS mochi_options (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    );
  } catch (err) {
    await sql.close().catch(() => {});
    throw err;
  }
  return {
    async get(key) {
      const rows = (await sql`SELECT value FROM mochi_options WHERE key = ${key}`) as Array<{ value: string }>;
      return rows[0]?.value;
    },
    async getVersioned(key) {
      const rows = (await sql`SELECT value, version FROM mochi_options WHERE key = ${key}`) as Array<{ value: string; version: number }>;
      return rows[0] ? { serialized: rows[0].value, version: rows[0].version } : undefined;
    },
    async insert(key, serialized, now) {
      const rows = (await sql`
        INSERT INTO mochi_options (key, value, created_at, updated_at) VALUES (${key}, ${serialized}, ${now}, ${now})
        ON CONFLICT (key) DO NOTHING RETURNING key`) as Array<{ key: string }>;
      return rows.length === 1;
    },
    async upsert(key, serialized, now) {
      await sql`
        INSERT INTO mochi_options (key, value, created_at, updated_at) VALUES (${key}, ${serialized}, ${now}, ${now})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, version = version + 1`;
    },
    async updateVersioned(key, serialized, expectedVersion, now) {
      const rows = (await sql`
        UPDATE mochi_options SET value = ${serialized}, version = version + 1, updated_at = ${now}
        WHERE key = ${key} AND version = ${expectedVersion} RETURNING key`) as Array<{ key: string }>;
      return rows.length === 1;
    },
    async delete(key) {
      const rows = (await sql`DELETE FROM mochi_options WHERE key = ${key} RETURNING key`) as Array<{ key: string }>;
      return rows.length === 1;
    },
    async close() {
      await sql.close();
    },
  };
}

const POSTGRES_DDL = [
  'CREATE SCHEMA IF NOT EXISTS mochi_options',
  'CREATE TABLE IF NOT EXISTS mochi_options.options (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)',
];

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
  return {
    async get(key) {
      const rows = (await sql`SELECT value FROM mochi_options.options WHERE key = ${key}`) as Array<{ value: string }>;
      return rows[0]?.value;
    },
    async getVersioned(key) {
      const rows = (await sql`SELECT value, version FROM mochi_options.options WHERE key = ${key}`) as Array<{ value: string; version: number }>;
      return rows[0] ? { serialized: rows[0].value, version: rows[0].version } : undefined;
    },
    async insert(key, serialized, now) {
      const rows = (await sql`
        INSERT INTO mochi_options.options (key, value, created_at, updated_at) VALUES (${key}, ${serialized}, ${now}, ${now})
        ON CONFLICT (key) DO NOTHING RETURNING key`) as Array<{ key: string }>;
      return rows.length === 1;
    },
    async upsert(key, serialized, now) {
      await sql`
        INSERT INTO mochi_options.options (key, value, created_at, updated_at) VALUES (${key}, ${serialized}, ${now}, ${now})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, version = options.version + 1`;
    },
    async updateVersioned(key, serialized, expectedVersion, now) {
      const rows = (await sql`
        UPDATE mochi_options.options SET value = ${serialized}, version = version + 1, updated_at = ${now}
        WHERE key = ${key} AND version = ${expectedVersion} RETURNING key`) as Array<{ key: string }>;
      return rows.length === 1;
    },
    async delete(key) {
      const rows = (await sql`DELETE FROM mochi_options.options WHERE key = ${key} RETURNING key`) as Array<{ key: string }>;
      return rows.length === 1;
    },
    async close() {
      await sql.close();
    },
  };
}

async function createPgliteDriver(instance: PGliteLike): Promise<OptionsDriver> {
  await instance.exec(POSTGRES_DDL.join('; '));
  return {
    async get(key) {
      const { rows } = await instance.query<{ value: string }>('SELECT value FROM mochi_options.options WHERE key = $1', [key]);
      return rows[0]?.value;
    },
    async getVersioned(key) {
      const { rows } = await instance.query<{ value: string; version: number }>('SELECT value, version FROM mochi_options.options WHERE key = $1', [key]);
      return rows[0] ? { serialized: rows[0].value, version: rows[0].version } : undefined;
    },
    async insert(key, serialized, now) {
      const { rows } = await instance.query(
        'INSERT INTO mochi_options.options (key, value, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING RETURNING key',
        [key, serialized, now, now],
      );
      return rows.length === 1;
    },
    async upsert(key, serialized, now) {
      await instance.query(
        'INSERT INTO mochi_options.options (key, value, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, version = options.version + 1',
        [key, serialized, now, now],
      );
    },
    async updateVersioned(key, serialized, expectedVersion, now) {
      const { rows } = await instance.query('UPDATE mochi_options.options SET value = $2, version = version + 1, updated_at = $4 WHERE key = $1 AND version = $3 RETURNING key', [
        key,
        serialized,
        expectedVersion,
        now,
      ]);
      return rows.length === 1;
    },
    async delete(key) {
      const { rows } = await instance.query('DELETE FROM mochi_options.options WHERE key = $1 RETURNING key', [key]);
      return rows.length === 1;
    },
    // The caller constructs and owns the PGlite instance (same contract as queue storage), so there is nothing to close.
    async close() {},
  };
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
  driver: OptionsDriver | null;
  initPromise: Promise<OptionsDriver> | null;
  storageOverride: MochiOptionsStorage | null;
}

const registry = pinGlobal<OptionsRegistry>('__mochi_options_registry__', () => ({
  driver: null,
  initPromise: null,
  storageOverride: null,
}));

function resolveStorage(method: string, key: string): MochiOptionsStorage {
  if (registry.storageOverride) {
    return registry.storageOverride;
  }
  let storage: MochiOptionsStorage | undefined;
  try {
    storage = getMochiConfig().options.optionsStorage;
  } catch {
    throw new Error(`MochiOptions.${method}("${key}"): Mochi.serve() has not been called yet. Options become available once Mochi.serve({ optionsStorage }) runs.`);
  }
  if (storage === undefined) {
    throw new Error(
      `MochiOptions.${method}("${key}"): no optionsStorage is configured. Pass optionsStorage to Mochi.serve() — ` +
        `{ sqlite: 'data/options.db' }, { postgres: url }, or { pglite: instance } — to enable the options store.`,
    );
  }
  return storage;
}

async function requireDriver(method: string, key: string): Promise<OptionsDriver> {
  if (registry.driver) {
    return registry.driver;
  }
  const storage = resolveStorage(method, key);
  if (!registry.initPromise) {
    const init = createDriver(storage).then((driver) => {
      registry.driver = driver;
      return driver;
    });
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

/** Idempotent, never throws — safe on every stop path and in test afterEach. */
export async function closeOptionsStorage(): Promise<void> {
  const pending = registry.initPromise;
  registry.initPromise = null;
  if (pending) {
    // An in-flight first call may still be opening the handle; settle it so the close below reaches it.
    await pending.catch(() => {});
  }
  const driver = registry.driver;
  registry.driver = null;
  if (!driver) {
    return;
  }
  try {
    await driver.close();
  } catch (err) {
    logger.warn(`MochiOptions storage close failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Test-only: point MochiOptions at a storage without booting Mochi.serve(). Pass `null` to clear. */
export function __testSetOptionsStorage(storage: MochiOptionsStorage | null): void {
  registry.storageOverride = storage;
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
  /**
   * Atomic read-modify-write: runs `fn` on the current value (`undefined` when missing) and writes the result,
   * re-reading and re-running `fn` when another writer lands in between — so `fn` must be pure. Resolves the
   * written value.
   */
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
    }
    throw new Error(`MochiOptions.modify("${key}"): gave up after ${MODIFY_MAX_ATTEMPTS} attempts — concurrent writers kept changing the key.`);
  },
  async delete(key) {
    assertKey('delete', key);
    const driver = await requireDriver('delete', key);
    return driver.delete(key);
  },
};
