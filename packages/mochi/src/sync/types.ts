import type { AuthContext, InferParams, InferRow, RateLimitConfig, SyncPresenceDef, SyncQueryMap, SyncViewDef } from 'reflectdb';
import type { ImplementOptions, RoomCallback } from 'reflectdb/server';

/**
 * A read-only view implementation. Mirrors reflectdb's (unexported) `ViewFn`: returns the view's rows for the given
 * auth/params. `params` collapses to a loose record when the schema declares none.
 */
export type MochiSyncViewFn<TQueries extends SyncQueryMap, K extends keyof TQueries, TDb> = (
  ctx: { auth: AuthContext; params: InferParams<TQueries, K> extends undefined ? Record<string, unknown> : InferParams<TQueries, K> },
  db: TDb,
) => InferRow<TQueries, K>[] | Promise<InferRow<TQueries, K>[]>;

/**
 * Where the sync op log lives: `'memory'` (reflectdb's built-in in-memory log, lost on restart), a SQLite file, or a
 * Postgres database. Mirrors `MochiQueueStorage`, minus the queue-only `pglite` shape.
 */
export type MochiSyncStorage = 'memory' | { sqlite: string } | { postgres: string };

/**
 * Resolves the current request's identity for a sync connection. Runs at the Mochi token endpoint with full
 * request context (cookies, locals) available via `getRequestContext()`. Return `null` to reject the connection;
 * an `AuthContext` (`{ userId, … }`) to accept. Omit `auth` entirely to serve anonymous clients.
 */
export type MochiSyncAuthFn = (req: Request) => AuthContext | null | Promise<AuthContext | null>;

/** Keys of a query map whose entry is a regular (writable) query — not a `view()` or `presence()` entry. */
export type SyncRegularKeys<TQueries extends SyncQueryMap> = {
  [K in keyof TQueries]: TQueries[K] extends SyncViewDef | SyncPresenceDef ? never : K;
}[keyof TQueries];

/** Keys of a query map whose entry is a `view()` (read-only computed query). */
export type SyncViewKeys<TQueries extends SyncQueryMap> = {
  [K in keyof TQueries]: TQueries[K] extends SyncViewDef ? K : never;
}[keyof TQueries];

/**
 * Server-side sync configuration passed to `Mochi.serve({ sync: defineSync({ … }) })`.
 *
 * Generic over the query map and the (optional) database handle threaded into `query`/`mutate`. `defineSync()` keeps
 * these generics for full inference at the call site while erasing them to the base shape stored on `MochiServeOptions`.
 */
export interface MochiSyncOptions<TQueries extends SyncQueryMap = SyncQueryMap, TDb = unknown> {
  /** The shared schema built with `defineSyncQueries({ … })`. Imported by both server routes and islands. */
  queries: TQueries;
  /**
   * Resolve the request's identity. Omit to serve anonymous clients (reflectdb's `allowAnonymous`). When present,
   * a connection must present a valid ticket minted for a non-null `auth` result.
   */
  auth?: MochiSyncAuthFn;
  /** Op-log storage. Default: `'memory'`. */
  storage?: MochiSyncStorage;
  /** Optional database handle, passed untouched to every `query`/`mutate`/`authorize`/`count`. */
  db?: TDb;
  /** Per-table implementations: `query` (read) plus optional `mutate`/`authorize`/`room`/`serverSet`/`broadcast`. */
  tables: {
    [K in SyncRegularKeys<TQueries> & string]: ImplementOptions<TQueries, K, AuthContext, TDb>;
  };
  /** Read-only computed queries declared with `view()` in the schema. */
  views?: {
    [K in SyncViewKeys<TQueries> & string]: MochiSyncViewFn<TQueries, K, TDb>;
  };
  /** Room access-control callbacks keyed by pattern (e.g. `'org/:orgId'`). */
  rooms?: Record<string, RoomCallback>;
  /** Global and per-table write rate limits. */
  rateLimit?: RateLimitConfig;
  /** Transport. Only `'ws'` is supported in v1; `'sse'` is reserved. Default: `'ws'`. */
  transport?: 'ws';
  /** Lifetime of a minted auth ticket in ms. Default: `600_000` (10 minutes). */
  ticketTtlMs?: number;
}

/**
 * The live handle returned by `sync<Row>(table)` inside an island. `rows`/`status`/`pending`/`total` are reactive
 * ($state-backed) getters; the mutators optimistically update locally and sync to the server.
 */
export interface MochiSyncHandle<Row> {
  /** The current rows for this table, reactive. */
  readonly rows: Row[];
  /** Connection status of the shared per-tab client. */
  readonly status: 'connecting' | 'connected' | 'synced' | 'disconnected' | 'error';
  /** Ops not yet acknowledged by the server. */
  readonly pending: number;
  /** Total server-side row count for windowed queries, or `null` when unknown. */
  readonly total: number | null;
  /** Optimistically insert a row; returns the generated (or supplied) row id. */
  insert(payload: Partial<Row>, id?: string): string;
  /** Optimistically patch a row by id. */
  update(id: string, payload: Partial<Row>): void;
  /** Optimistically delete a row by id. */
  remove(id: string): void;
  /** Grow a windowed subscription by `count` rows. */
  loadMore(count: number): void;
  /** Release this handle's subscription (refcounted; the shared client stays up for other handles). */
  destroy(): void;
}

/** Options for `sync(table, params?, opts?)`. */
export interface MochiSyncOptions_Client {
  /**
   * Which named connection this subscription rides. Each name gets its own client, WebSocket, and local store, so two
   * connections can diverge (e.g. one taken offline). Shared per name per tab. Default: `'default'`.
   */
  connection?: string;
}

/**
 * A control handle for one named sync connection, from `syncConnection(name)`. `online`, `status`, and `pending` are
 * reactive ($state-backed); `setOnline(false)` drops the socket while keeping local rows and queuing writes locally,
 * and `setOnline(true)` reconnects and resyncs, delivering the queued writes.
 */
export interface MochiSyncConnection {
  /** `false` while the connection is held offline via `setOnline(false)`. */
  readonly online: boolean;
  /** Connection status (`'disconnected'` while offline). */
  readonly status: MochiSyncHandle<unknown>['status'];
  /** Ops queued locally but not yet acknowledged by the server. */
  readonly pending: number;
  /** Take the connection offline (`false`) or bring it back online and resync (`true`). */
  setOnline(value: boolean): void;
}
