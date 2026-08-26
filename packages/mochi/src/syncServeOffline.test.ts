import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { defineSyncQueries, t } from 'reflectdb';
import { createSyncClient } from 'reflectdb/client';
import type { TypedSyncClient } from 'reflectdb/client';
import type { ClientMessage, ClientTransport, ServerMessage } from 'reflectdb';
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

/**
 * Mirrors the framework's `ManagedTransport` (sync.client.svelte.ts): a client transport whose socket can be dropped
 * and recreated so a connection can be taken offline and later reconnected — the mechanism behind `syncConnection`.
 */
class ManagedTransport implements ClientTransport {
  private inner: (ClientTransport & { getSocket(): WebSocket | null }) | null = null;
  private handler: ((message: ServerMessage) => void) | null = null;
  online = true;
  constructor(private url: string) {}
  private ensureInner(): ClientTransport {
    if (!this.inner) {
      this.inner = createWsClientTransport({ url: this.url });
      if (this.handler) {
        this.inner.subscribe(this.handler);
      }
    }
    return this.inner;
  }
  setOnline(value: boolean): void {
    if (value === this.online) {
      return;
    }
    this.online = value;
    if (!value) {
      void this.inner?.close();
      this.inner = null;
    }
  }
  async send(message: ClientMessage): Promise<void> {
    if (!this.online) {
      throw new Error('offline');
    }
    return this.ensureInner().send(message);
  }
  subscribe(handler: (message: ServerMessage) => void): void {
    this.handler = handler;
    if (this.inner) {
      this.inner.subscribe(handler);
    }
  }
  async close(): Promise<void> {
    this.online = false;
    await this.inner?.close();
    this.inner = null;
  }
}

describe('Mochi.serve({ sync }) — named connections + offline/reconnect', () => {
  let server: Server<undefined>;
  let outDir: string;
  let wsUrl: string;
  const store = new Map<string, Todo>();

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sync-offline-'));
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
    wsUrl = `ws://localhost:${server.port}/_mochi/sync/ws`;
  });

  afterAll(async () => {
    await server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  function ids(client: TypedSyncClient<typeof queries>): string[] {
    return client
      .getRows('todos')
      .map((r) => r.id)
      .sort();
  }

  async function connect(clientId: string, transport: ClientTransport): Promise<TypedSyncClient<typeof queries>> {
    const client = createSyncClient({ queries, clientId, transport, token: 'anonymous' });
    await client.init();
    await client.connect();
    await client.sync('todos');
    client.scheduleBootstrap();
    return client;
  }

  test('two connections diverge while one is offline, then converge after reconnect', async () => {
    const aTransport = new ManagedTransport(wsUrl);
    const a = await connect('conn-a', aTransport);
    const b = await connect('conn-b', new ManagedTransport(wsUrl));

    // Online: A's write reaches the server and B.
    a.insert('todos', 'r1', { text: 'online', done: false });
    await a.push();
    await waitFor(() => store.has('r1'));
    await waitFor(() => b.getRows('todos').some((r) => r.id === 'r1'));

    // A goes offline — its socket drops, but local state survives.
    aTransport.setOnline(false);
    await new Promise((r) => setTimeout(r, 100));

    // A writes while offline — ops queue locally, never reaching the server.
    a.insert('todos', 'r2', { text: 'offline-a', done: false });
    await a.push().catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    expect(a.getPendingCount()).toBe(1);
    expect(store.has('r2')).toBe(false);
    expect(ids(a)).toEqual(['r1', 'r2']);

    // B writes while A is offline — A must NOT see it yet.
    b.insert('todos', 'r3', { text: 'from-b', done: false });
    await b.push();
    await waitFor(() => store.has('r3'));
    expect(a.getRows('todos').some((r) => r.id === 'r3')).toBe(false);

    // A comes back online: reconnect, re-declare, bootstrap, push the queued op.
    aTransport.setOnline(true);
    await a.connect();
    await a.sync('todos');
    a.scheduleBootstrap();
    await a.push();

    // The offline op lands on the server, and A converges with B.
    await waitFor(() => store.has('r2'));
    await waitFor(() => a.getRows('todos').some((r) => r.id === 'r3'));
    await waitFor(() => ids(a).join() === ids(b).join());

    expect(a.getPendingCount()).toBe(0);
    expect(ids(a)).toEqual(['r1', 'r2', 'r3']);
    expect(ids(b)).toEqual(['r1', 'r2', 'r3']);
    expect([...store.keys()].sort()).toEqual(['r1', 'r2', 'r3']);

    await a.close();
    await b.close();
  });
});
