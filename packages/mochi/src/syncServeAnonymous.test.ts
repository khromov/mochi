import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
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

describe('Mochi.serve({ sync }) — anonymous (no auth)', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let wsUrl: string;
  const store = new Map<string, Todo>();

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sync-anon-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      proxy: { hostHeader: 'host' },
      sync: defineSync({
        queries,
        db: store,
        tables: {
          todos: {
            query: (_ctx, db) => [...(db as Map<string, Todo>).values()],
            mutate: async (op, _ctx, db) => {
              const map = db as Map<string, Todo>;
              if (op.type === 'delete') {
                map.delete(op.rowId);
                return;
              }
              map.set(op.rowId, { id: op.rowId, ...op.payload } as Todo);
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

  test('the token endpoint returns an anonymous token', async () => {
    const res = await fetch(`${base}/_mochi/sync/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toBe('anonymous');
  });

  test('an anonymous client connects and syncs', async () => {
    const client = createSyncClient({
      queries,
      clientId: 'anon-client',
      transport: createWsClientTransport({ url: wsUrl }),
      token: 'anonymous',
    });
    await client.init();
    await client.connect();
    await client.sync('todos');
    client.scheduleBootstrap();

    const id = crypto.randomUUID();
    client.insert('todos', id, { text: 'anon todo', done: false });
    await client.push();

    await waitFor(() => store.has(id));
    expect(store.get(id)).toMatchObject({ text: 'anon todo' });
    await client.close();
  });
});
