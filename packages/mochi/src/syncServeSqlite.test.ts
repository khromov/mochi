import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { defineSyncQueries, t } from 'reflectdb';
import { createSyncClient } from 'reflectdb/client';
import { createWsClientTransport } from 'reflectdb/transport/ws';
import { Mochi } from './Mochi';
import { defineSync } from './sync/index';

type Todo = { id: string; text: string; done: boolean };
const queries = defineSyncQueries({ todos: { row: t<Todo>() } });

async function waitFor(fn: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Mochi.serve({ sync }) — sqlite op-log storage', () => {
  let server: Server<undefined>;
  let outDir: string;
  let sqlitePath: string;
  let base: string;
  let wsUrl: string;
  const store = new Map<string, Todo>();

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sync-sqlite-'));
    // Nested under a not-yet-created .db/ dir to exercise the parent-mkdir path.
    sqlitePath = path.join(outDir, '.db', 'sync.sqlite');
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      proxy: { hostHeader: 'host' },
      sync: defineSync({
        queries,
        db: store,
        storage: { sqlite: sqlitePath },
        tables: {
          todos: {
            query: (_ctx, db) => [...(db as Map<string, Todo>).values()],
            mutate: async (op, _ctx, db) => {
              (db as Map<string, Todo>).set(op.rowId, { id: op.rowId, ...op.payload } as Todo);
            },
          },
        },
      }),
      routes: { '/health': Mochi.api(async () => Response.json({ ok: true })) },
    });
    base = `http://localhost:${server.port}`;
    wsUrl = `ws://localhost:${server.port}/_mochi/sync/ws`;
  });

  afterAll(async () => {
    await server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('creates the parent directory and the op-log file', async () => {
    // The file is created eagerly when the storage adapter is built at boot.
    expect(existsSync(sqlitePath)).toBe(true);
  });

  test('persists an insert to the op log', async () => {
    const res = await fetch(`${base}/_mochi/sync/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: '{}',
    });
    const { token } = (await res.json()) as { token: string };
    const client = createSyncClient({
      queries,
      clientId: 'sqlite-client',
      transport: createWsClientTransport({ url: wsUrl }),
      token,
    });
    await client.init();
    await client.connect();
    await client.sync('todos');
    client.scheduleBootstrap();

    const id = crypto.randomUUID();
    client.insert('todos', id, { text: 'persisted', done: false });
    await client.push();

    await waitFor(() => store.has(id));
    expect(existsSync(sqlitePath)).toBe(true);
    // The op-log path must render with forward slashes on every platform.
    expect(sqlitePath.split(path.sep).join('/')).not.toContain('\\');
    await client.close();
  });
});
