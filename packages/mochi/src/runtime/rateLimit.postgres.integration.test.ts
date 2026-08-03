import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { postgresStore } from './rateLimit';
import { json } from '../utils';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';

// Exercises the real `postgresStore()` backend (bun:sql over the wire) against an in-process
// PGlite Postgres. The memory/sqlite stores have coverage; this closes the Postgres gap and
// proves counters actually round-trip to a Postgres server, not a local map.
describe('rateLimit postgresStore backend', () => {
  let pg: TestPostgres;
  let store: ReturnType<typeof postgresStore>;
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    pg = await startTestPostgres();
    store = postgresStore({ url: pg.url });
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-pg-ratelimit-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/api/limited': Mochi.api(async () => json({ ok: true }), { rateLimit: { limit: 2, window: '1m', store } }),
      },
    });
    base = `http://localhost:${server.port}`;
    // PGlite's WASM boot can take ~10s on slow machines — well past the default hook budget.
  }, 60_000);

  afterAll(async () => {
    server?.stop(true);
    await store?.shutdown?.();
    await pg?.close();
    rmSync(outDir, { recursive: true, force: true });
  }, 20_000);

  test('blocks with 429 once the limit is exhausted', async () => {
    expect((await fetch(`${base}/api/limited`)).status).toBe(200);
    expect((await fetch(`${base}/api/limited`)).status).toBe(200);
    expect((await fetch(`${base}/api/limited`)).status).toBe(429);
  });

  test('persists the counter to Postgres over the wire', async () => {
    const { rows } = await pg.query<{ key: string; count: number }>('SELECT key, count FROM hitlimit_hits');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(Number(row?.count)).toBeGreaterThanOrEqual(2);
  });
});
