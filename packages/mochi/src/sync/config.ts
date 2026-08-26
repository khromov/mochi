import path from 'node:path';
import type { ServerTransport, SyncPresenceDef, SyncQueryMap, SyncViewDef } from 'reflectdb';
import type { TypedSyncServer } from 'reflectdb/server';
import type { createBunWsServerTransport } from 'reflectdb/transport/bun-ws';
import { logger } from '../utils/log';
import { toPosixPath } from '../utils';
import type { MochiSyncAuthFn, MochiSyncOptions, MochiSyncStorage } from './types';

export const DEFAULT_TICKET_TTL_MS = 600_000;

export interface ResolvedSyncOptions extends MochiSyncOptions {
  storage: MochiSyncStorage;
  ticketTtlMs: number;
  transport: 'ws';
}

/** Fill sync defaults: `'memory'` storage, a 10-minute ticket TTL, WebSocket transport. */
export function resolveSyncOptions(options: MochiSyncOptions): ResolvedSyncOptions {
  return {
    ...options,
    storage: options.storage ?? 'memory',
    ticketTtlMs: options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS,
    transport: options.transport ?? 'ws',
  };
}

const storageChecks: Record<string, (value: unknown) => boolean> = {
  sqlite: (value) => typeof value === 'string' && value.length > 0,
  postgres: (value) => typeof value === 'string' && value.length > 0,
};

/** Runtime-validates the storage shape, since `sync` config often arrives from untyped JS callers. */
export function isValidSyncStorage(storage: MochiSyncStorage): boolean {
  if (storage === 'memory') {
    return true;
  }
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

function isView(entry: unknown): entry is SyncViewDef {
  return typeof entry === 'object' && entry !== null && (entry as { __view?: boolean }).__view === true;
}

function isPresence(entry: unknown): entry is SyncPresenceDef {
  return typeof entry === 'object' && entry !== null && (entry as { __presence?: boolean }).__presence === true;
}

/**
 * Fail-fast validation for `Mochi.serve({ sync })`, run before the config singleton pins. Rejects an empty schema,
 * a bad storage shape, a non-`'ws'` transport, `tables` keys that aren't regular queries, regular queries missing a
 * `tables` implementation, and `views` keys that aren't `view()` entries. Warns on a sqlite path shared with the queue.
 */
export function validateSyncOptions(sync: MochiSyncOptions, queueSqlitePath?: string): void {
  const queries = sync.queries;
  if (typeof queries !== 'object' || queries === null || Object.keys(queries).length === 0) {
    throw new Error(`Mochi.serve({ sync }): "queries" must be a non-empty schema built with defineSyncQueries({ … }).`);
  }

  const storage = sync.storage ?? 'memory';
  if (!isValidSyncStorage(storage)) {
    throw new Error(`Mochi.serve({ sync }): "storage" must be 'memory', { sqlite: 'path/to.db' }, or { postgres: url }.`);
  }

  if (sync.transport !== undefined && sync.transport !== 'ws') {
    throw new Error(`Mochi.serve({ sync }): transport '${String(sync.transport)}' is not supported yet — only 'ws' (WebSocket) is available.`);
  }

  const map = queries as SyncQueryMap;
  const tables = (sync.tables ?? {}) as Record<string, unknown>;
  const views = (sync.views ?? {}) as Record<string, unknown>;

  for (const name of Object.keys(tables)) {
    const def = map[name];
    if (def === undefined) {
      throw new Error(`Mochi.serve({ sync }): tables["${name}"] has no matching entry in the schema.`);
    }
    if (isView(def)) {
      throw new Error(`Mochi.serve({ sync }): "${name}" is a view() — implement it under "views", not "tables".`);
    }
    if (isPresence(def)) {
      throw new Error(`Mochi.serve({ sync }): "${name}" is a presence() channel and cannot be implemented under "tables".`);
    }
  }

  for (const name of Object.keys(views)) {
    const def = map[name];
    if (def === undefined) {
      throw new Error(`Mochi.serve({ sync }): views["${name}"] has no matching entry in the schema.`);
    }
    if (!isView(def)) {
      throw new Error(`Mochi.serve({ sync }): "${name}" is not a view() entry — only view() queries go under "views".`);
    }
  }

  for (const [name, def] of Object.entries(map)) {
    if (isView(def) || isPresence(def)) {
      continue;
    }
    if (!(name in tables)) {
      throw new Error(`Mochi.serve({ sync }): the "${name}" query has no implementation — add tables["${name}"] with a query (and optional mutate).`);
    }
  }

  if (storage !== 'memory' && 'sqlite' in storage && queueSqlitePath) {
    if (path.resolve(storage.sqlite) === path.resolve(queueSqlitePath)) {
      logger.warn(`Mochi.serve({ sync }): the sync sqlite store (${toPosixPath(storage.sqlite)}) is the same file as queueStorage — give sync its own file to avoid table churn.`);
    }
  }
}

export interface SyncRuntime {
  server: TypedSyncServer<SyncQueryMap>;
  websocket: ReturnType<typeof createBunWsServerTransport>['websocket'];
  transport: ServerTransport;
  auth?: MochiSyncAuthFn;
  ticketTtlMs: number;
  close(): Promise<void>;
}

// Pinned on globalThis like `__mochi_config__` / `__mochi_email_runtime__`: compiled Svelte bundles each get their own
// copy of this module yet must share one runtime instance.
const GLOBAL_KEY = '__mochi_sync_runtime__';

export function setSyncRuntime(runtime: SyncRuntime): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = runtime;
}

export function getSyncRuntime(): SyncRuntime | undefined {
  return (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] as SyncRuntime | undefined;
}

/** The live typed sync server, or a clear throw when `Mochi.serve({ sync })` was never configured. */
export function requireSyncServer(): TypedSyncServer<SyncQueryMap> {
  const runtime = getSyncRuntime();
  if (!runtime) {
    throw new Error('Mochi.sync() requires Mochi.serve({ sync }) to be configured.');
  }
  return runtime.server;
}

/** Idempotently close the sync runtime and clear the global pin. */
export async function closeSyncRuntime(): Promise<void> {
  const g = globalThis as unknown as Record<string, unknown>;
  const runtime = g[GLOBAL_KEY] as SyncRuntime | undefined;
  if (!runtime) {
    return;
  }
  g[GLOBAL_KEY] = undefined;
  await runtime.close();
}
