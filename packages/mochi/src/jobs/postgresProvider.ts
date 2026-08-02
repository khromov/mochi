// Bridges queuert's Postgres state adapter onto Bun's builtin `Bun.SQL` client — no driver dependency. Modeled on
// queuert's official postgres.js provider; note Bun.SQL has no LISTEN/NOTIFY yet, so there is no notify provider here
// and cross-instance pickup rides the worker's poll interval.
import type { SQL } from 'bun';
import type { PgStateProvider, RuntimeType } from '@queuert/postgres';

export type BunSqlJobsContext = { sql: SQL };

/** A `PgStateProvider` over a `Bun.SQL` pool. Transactions reserve a dedicated connection via `sql.begin`. */
export function createBunSqlStateProvider({ sql }: { sql: SQL }): PgStateProvider<BunSqlJobsContext> {
  // Bun.SQL sends JS strings as text and objects via its own serialization; jsonb/array parameters need explicit
  // shaping so Postgres sees the type the adapter's SQL expects.
  const serializeParam = (value: unknown, type: RuntimeType | undefined): unknown => {
    if (value === undefined || value === null) {
      return null;
    }
    if (type === 'array' || type === 'jsonArray') {
      const items = type === 'jsonArray' ? (value as unknown[]).map((el) => JSON.stringify(el)) : (value as unknown[]);
      return sql.array(items as never);
    }
    if (type === 'json' || type === 'json?') {
      return JSON.stringify(value);
    }
    return value;
  };

  return {
    transactionConcurrency: 'concurrent',
    withTransaction: async (fn) => (await sql.begin(async (txSql) => fn({ sql: txSql as unknown as SQL }))) as never,
    // Bun.SQL tracks transaction state client-side and rejects raw SAVEPOINT statements through `unsafe`, so the
    // driver's own savepoint API is required here.
    withSavepoint: async (txCtx, fn) =>
      (await (txCtx.sql as unknown as { savepoint: <T>(cb: (sp: SQL) => Promise<T>) => Promise<T> }).savepoint(async (spSql) => fn({ sql: spSql }))) as never,
    executeSql: async ({ txCtx, sql: query, params, paramTypes }) => {
      const client = txCtx?.sql ?? sql;
      if (!params || params.length === 0) {
        return (await client.unsafe(query)) as unknown[];
      }
      const serialized = params.map((value, i) => serializeParam(value, paramTypes[i]));
      return (await client.unsafe(query, serialized as never)) as unknown[];
    },
  };
}
