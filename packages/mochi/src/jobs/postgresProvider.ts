// Bridges queuert's Postgres state adapter onto Bun's builtin `Bun.SQL` client — no driver dependency. Modeled on
// queuert's official postgres.js provider; note Bun.SQL has no LISTEN/NOTIFY yet, so there is no notify provider here
// and cross-instance pickup rides the worker's poll interval.
import type { SQL } from 'bun';
import type { PgStateProvider, RuntimeType } from '@queuert/postgres';

export type BunSqlJobsContext = { sql: SQL };

// Postgres array-literal syntax ({"a","b"}), since `sql.array()` only works in tagged templates — through `unsafe()`
// params the elements arrive JSON-quoted and fail the `$n::uuid[]` cast.
function toPgArrayLiteral(items: readonly unknown[]): string {
  const parts = items.map((el) => (el === null || el === undefined ? 'NULL' : `"${String(el).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`));
  return `{${parts.join(',')}}`;
}

/** A `PgStateProvider` over a `Bun.SQL` pool. Transactions reserve a dedicated connection via `sql.begin`. */
export function createBunSqlStateProvider({ sql }: { sql: SQL }): PgStateProvider<BunSqlJobsContext> {
  const serializeParam = (value: unknown, type: RuntimeType | undefined): unknown => {
    if (value === undefined || value === null) {
      return null;
    }
    if (type === 'array') {
      return toPgArrayLiteral(value as unknown[]);
    }
    if (type === 'jsonArray') {
      return toPgArrayLiteral((value as unknown[]).map((el) => JSON.stringify(el)));
    }
    if (type === 'json' || type === 'json?') {
      // Bun JSON-encodes objects/strings bound to a jsonb placeholder itself; pre-stringifying would double-encode.
      // Top-level numbers/booleans are the exception — Bun types them as int/bool, which jsonb rejects.
      return typeof value === 'number' || typeof value === 'boolean' ? JSON.stringify(value) : value;
    }
    return value;
  };

  // Column coercion the interface asks of providers whose driver doesn't parse everything natively: over the wire
  // (PGlite included) jsonb, int8, and timestamps can surface as strings. Values the driver already parsed pass through.
  const parseColumn = (value: unknown, type: RuntimeType): unknown => {
    if (value === null || value === undefined) {
      return value;
    }
    switch (type) {
      case 'json':
      case 'json?':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'number':
      case 'number?':
        return typeof value === 'number' ? value : Number(value);
      case 'boolean':
      case 'boolean?':
        return typeof value === 'boolean' ? value : value === 't' || value === 'true';
      case 'date?':
        return value instanceof Date ? value : new Date(value as string);
      default:
        return value;
    }
  };

  const parseRows = (rows: unknown[], columnTypes: Record<string, RuntimeType>): unknown[] => {
    const entries = Object.entries(columnTypes);
    if (entries.length === 0) {
      return rows;
    }
    for (const row of rows as Record<string, unknown>[]) {
      for (const [column, type] of entries) {
        if (column in row) {
          row[column] = parseColumn(row[column], type);
        }
      }
    }
    return rows;
  };

  return {
    transactionConcurrency: 'concurrent',
    withTransaction: async (fn) => (await sql.begin(async (txSql) => fn({ sql: txSql as unknown as SQL }))) as never,
    // Bun.SQL tracks transaction state client-side and rejects raw SAVEPOINT statements through `unsafe`, so the
    // driver's own savepoint API is required here.
    withSavepoint: async (txCtx, fn) =>
      (await (txCtx.sql as unknown as { savepoint: <T>(cb: (sp: SQL) => Promise<T>) => Promise<T> }).savepoint(async (spSql) => fn({ sql: spSql }))) as never,
    executeSql: async ({ txCtx, sql: query, params, paramTypes, columnTypes }) => {
      const client = txCtx?.sql ?? sql;
      if (!params || params.length === 0) {
        return parseRows((await client.unsafe(query)) as unknown[], columnTypes);
      }
      const serialized = params.map((value, i) => serializeParam(value, paramTypes[i]));
      return parseRows((await client.unsafe(query, serialized as never)) as unknown[], columnTypes);
    },
  };
}
