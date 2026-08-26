import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { defineSyncQueries, t } from 'reflectdb';
import { createSyncClient } from 'reflectdb/client';
import type { TypedSyncClient } from 'reflectdb/client';
import { createWsClientTransport } from 'reflectdb/transport/ws';
import { Mochi } from './Mochi';
import { defineSync } from './sync/index';
import { getRequestContext } from './runtime/requestContext';
import { mochiEvents } from './events';

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

describe('Mochi.serve({ sync }) — authenticated, memory storage', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let wsUrl: string;
  const store = new Map<string, Todo>();

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sync-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      proxy: { hostHeader: 'host' },
      sync: defineSync({
        queries,
        auth: () => {
          const user = getRequestContext().cookies.get('mochi-sync-user');
          return user ? { userId: user } : null;
        },
        tables: {
          todos: {
            query: () => [...store.values()],
            mutate: async (op) => {
              if (op.type === 'delete') {
                store.delete(op.rowId);
                return;
              }
              const payload = op.payload ?? {};
              const existing = store.get(op.rowId) ?? { id: op.rowId, text: '', done: false };
              store.set(op.rowId, { ...existing, ...payload, id: op.rowId } as Todo);
            },
          },
        },
      }),
      routes: {
        '/health': Mochi.api(async () => Response.json({ ok: true })),
      },
    });
    base = `http://localhost:${server.port}`;
    wsUrl = `ws://localhost:${server.port}/_mochi/sync/ws`;
  });

  afterAll(async () => {
    await server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  async function fetchToken(cookie?: string): Promise<Response> {
    return fetch(`${base}/_mochi/sync/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
      body: '{}',
    });
  }

  test('token endpoint rejects a request without the auth cookie', async () => {
    const res = await fetchToken();
    expect(res.status).toBe(401);
  });

  test('token endpoint mints a ticket with the auth cookie', async () => {
    const res = await fetchToken('mochi-sync-user=alice');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { token: string; ttlMs: number };
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.ttlMs).toBe(600_000);
  });

  test('token endpoint is POST-only and JSON-only', async () => {
    const get = await fetch(`${base}/_mochi/sync/token`, { method: 'GET' });
    expect(get.status).toBe(405);
    const wrongType = await fetch(`${base}/_mochi/sync/token`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: base }, body: 'x' });
    expect(wrongType.status).toBe(415);
  });

  async function connectClient(clientId: string): Promise<TypedSyncClient<typeof queries>> {
    const getTicket = async (): Promise<string> => {
      const res = await fetchToken('mochi-sync-user=alice');
      return ((await res.json()) as { token: string }).token;
    };
    const token = await getTicket();
    const client = createSyncClient({
      queries,
      clientId,
      transport: createWsClientTransport({ url: wsUrl }),
      token,
      onReauth: getTicket,
    });
    await client.init();
    await client.connect();
    await client.sync('todos');
    client.scheduleBootstrap();
    return client;
  }

  test('two clients sync inserts and server-side emits over the live socket', async () => {
    const events: string[] = [];
    mochiEvents.setHandler('test:sync-open', 'sync:open', () => events.push('open'));
    mochiEvents.setHandler('test:sync-op', 'sync:op', (e) => events.push(`op:${e.accepted}`));

    const a = await connectClient('client-a');
    const b = await connectClient('client-b');

    // Insert on A → server Map updated → B sees the delta. insert() only queues the op; push() transmits it.
    const id = crypto.randomUUID();
    a.insert('todos', id, { text: 'buy milk', done: false });
    await a.push();

    await waitFor(() => store.has(id));
    expect(store.get(id)).toMatchObject({ text: 'buy milk', done: false });

    await waitFor(() => b.getRows('todos').some((r) => r.id === id));
    expect(b.getRows('todos').find((r) => r.id === id)).toMatchObject({ text: 'buy milk' });

    // Server-side out-of-band write: update the store, then notifyChange re-runs the query and broadcasts the diff
    // to every subscriber. (This is the primitive for an external-store app; emit()/applyServerOp write reflectdb's
    // own mirror instead, which a store-backed query wouldn't observe.)
    store.set('server-row', { id: 'server-row', text: 'from server', done: true });
    await Mochi.sync<typeof queries>().notifyChange('todos');

    await waitFor(() => a.getRows('todos').some((r) => r.id === 'server-row'));
    await waitFor(() => b.getRows('todos').some((r) => r.id === 'server-row'));

    expect(events).toContain('open');
    expect(events.some((e) => e.startsWith('op:'))).toBe(true);

    mochiEvents.removeHandler('test:sync-open');
    mochiEvents.removeHandler('test:sync-op');
    await a.close();
    await b.close();
  });

  test('a garbage token is rejected by the server', async () => {
    let rejected = false;
    const client = createSyncClient({
      queries,
      clientId: 'client-bad',
      transport: createWsClientTransport({ url: wsUrl }),
      token: 'not-a-valid-ticket',
      onError: () => {
        rejected = true;
      },
    });
    await client.init();
    await client.connect().catch(() => {
      rejected = true;
    });
    await client.sync('todos').catch(() => {
      rejected = true;
    });
    // Give the server a beat to reject the handshake / auth.
    await waitFor(() => rejected || client.getState() === 'disconnected', 3000).catch(() => {});
    expect(rejected || client.getState() === 'disconnected').toBe(true);
    await client.close();
  });
});
