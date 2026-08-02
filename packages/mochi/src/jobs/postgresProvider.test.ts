import { describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { createBunSqlStateProvider } from './postgresProvider';

// A recording stand-in with Bun.SQL's shape: `begin`/`savepoint` hand the callback a scoped client, `unsafe` executes,
// `array` tags PG array parameters. Real-Postgres behavior is covered by the TEST_PG_URL-gated conformance test below.
function fakeSql(calls: Array<{ via: string; sql: string; params?: unknown[] }>, label = 'root'): SQL {
  const client = {
    unsafe: async (sql: string, params?: unknown[]) => {
      calls.push(params === undefined ? { via: label, sql } : { via: label, sql, params });
      return [];
    },
    begin: async <T>(fn: (tx: SQL) => Promise<T>): Promise<T> => {
      calls.push({ via: label, sql: 'BEGIN' });
      const result = await fn(fakeSql(calls, 'tx'));
      calls.push({ via: label, sql: 'COMMIT' });
      return result;
    },
    savepoint: async <T>(fn: (sp: SQL) => Promise<T>): Promise<T> => {
      calls.push({ via: label, sql: 'SAVEPOINT' });
      const result = await fn(fakeSql(calls, 'sp'));
      calls.push({ via: label, sql: 'RELEASE' });
      return result;
    },
    array: (items: unknown[]) => ({ __pgArray: items }),
  };
  return client as unknown as SQL;
}

describe('createBunSqlStateProvider', () => {
  test('withTransaction brackets the callback in begin/commit and hands out the tx client', async () => {
    const calls: Array<{ via: string; sql: string; params?: unknown[] }> = [];
    const provider = createBunSqlStateProvider({ sql: fakeSql(calls) });

    await provider.withTransaction(async (txCtx) => {
      await provider.executeSql({ txCtx, sql: 'INSERT 1', params: ['a'], paramTypes: { 0: 'string' }, columnTypes: {}, readOnly: false });
    });

    expect(calls.map((c) => `${c.via}:${c.sql}`)).toEqual(['root:BEGIN', 'tx:INSERT 1', 'root:COMMIT']);
  });

  test('withSavepoint uses the driver savepoint API on the transaction client', async () => {
    const calls: Array<{ via: string; sql: string }> = [];
    const provider = createBunSqlStateProvider({ sql: fakeSql(calls) });

    await provider.withTransaction(async (txCtx) => {
      await provider.withSavepoint!(txCtx, async (spCtx) => {
        await provider.executeSql({ txCtx: spCtx, sql: 'UPDATE 1', params: [], paramTypes: {}, columnTypes: {}, readOnly: false });
      });
    });

    expect(calls.map((c) => `${c.via}:${c.sql}`)).toEqual(['root:BEGIN', 'tx:SAVEPOINT', 'sp:UPDATE 1', 'tx:RELEASE', 'root:COMMIT']);
  });

  test('executeSql runs on the pool outside a transaction and serializes typed params', async () => {
    const calls: Array<{ via: string; sql: string; params?: unknown[] }> = [];
    const provider = createBunSqlStateProvider({ sql: fakeSql(calls) });

    await provider.executeSql({
      sql: 'SELECT $1, $2, $3, $4, $5, $6',
      params: [{ nested: true }, ['a', 'b'], [{ x: 1 }], null, 'plain', 42],
      paramTypes: { 0: 'json', 1: 'array', 2: 'jsonArray', 3: 'string?', 4: 'string', 5: 'json' },
      columnTypes: { any: 'string' },
      readOnly: true,
    });

    expect(calls).toHaveLength(1);
    const [jsonParam, arrayParam, jsonArrayParam, nullParam, plainParam, numericJsonParam] = calls[0]!.params!;
    // Objects pass through raw — Bun JSON-encodes values bound to jsonb placeholders itself.
    expect(jsonParam).toEqual({ nested: true });
    // Arrays become Postgres array literals; sql.array() only works in tagged templates, not unsafe() params.
    expect(arrayParam).toBe('{"a","b"}');
    expect(jsonArrayParam).toBe('{"{\\"x\\":1}"}');
    expect(nullParam).toBeNull();
    expect(plainParam).toBe('plain');
    // Top-level numbers/booleans are the exception: Bun would type them as int/bool, which jsonb rejects.
    expect(numericJsonParam).toBe('42');
  });

  test('parses json/number/date columns the driver returns as strings', async () => {
    const rows = [{ payload: '{"a":1}', n: '7', when: '2026-08-03T00:00:00Z', already: { b: 2 } }];
    const provider = createBunSqlStateProvider({
      sql: { unsafe: async () => rows } as unknown as Parameters<typeof createBunSqlStateProvider>[0]['sql'],
    });

    const [row] = (await provider.executeSql({
      sql: 'SELECT …',
      params: [],
      paramTypes: {},
      columnTypes: { payload: 'json', n: 'number', when: 'date?', already: 'json?' },
      readOnly: true,
    })) as Array<Record<string, unknown>>;

    expect(row!.payload).toEqual({ a: 1 });
    expect(row!.n).toBe(7);
    expect(row!.when).toEqual(new Date('2026-08-03T00:00:00Z'));
    // Values the driver already parsed pass through untouched.
    expect(row!.already).toEqual({ b: 2 });
  });
});

// Full conformance needs a REAL multi-connection server: its read-isolation cases hold a transaction open on one
// connection while reading from another, which the in-process PGlite fixture cannot honor (single session; extra
// clients are multiplexed at statement granularity, and with a max:1 pool those cases deadlock). Wire-level behavior is
// covered continuously by jobs.postgres.test.ts against PGlite; run this with e.g.
// TEST_PG_URL=postgres://user:pass@localhost:5432/queuert_test bun test src/jobs/postgresProvider.test.ts.
describe.if(!!process.env.TEST_PG_URL)('bun.sql provider against real Postgres', () => {
  test('passes queuert’s state adapter conformance suite', async () => {
    const { SQL } = await import('bun');
    const { createPgStateAdapter } = await import('@queuert/postgres');
    const { runStateAdapterConformance } = await import('queuert/conformance');

    const sql = new SQL(process.env.TEST_PG_URL!);
    try {
      const report = await runStateAdapterConformance(async () => {
        const stateAdapter = await createPgStateAdapter({ stateProvider: createBunSqlStateProvider({ sql }) });
        await stateAdapter.migrateToLatest();
        return {
          stateAdapter,
          reset: async () => stateAdapter.truncate(),
          dispose: async () => stateAdapter.close(),
        };
      });
      expect(report.failed).toBe(0);
    } finally {
      await sql.close();
    }
  }, 300_000);
});
