import { onDestroy } from 'svelte';
import { SyncClient, pushSafely } from 'reflectdb/client';
import type { SyncClientState } from 'reflectdb/client';
import type { ClientMessage, ClientTransport, ServerMessage } from 'reflectdb';
import { createWsClientTransport } from 'reflectdb/transport/ws';
import { pinGlobal } from '../utils/globalState';
import type { MochiSyncConnection, MochiSyncHandle, MochiSyncOptions_Client } from './types';

type Status = MochiSyncHandle<unknown>['status'];

interface SyncEndpoints {
  /** Token endpoint. */
  t: string;
  /** WebSocket path. */
  w: string;
}

function endpoints(): SyncEndpoints {
  const cfg = (window as unknown as { __mochi_sync?: SyncEndpoints }).__mochi_sync;
  return cfg ?? { t: '/_mochi/sync/token', w: '/_mochi/sync/ws' };
}

function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

// crypto.randomUUID only exists in secure contexts (https/localhost); plain-http LAN dev needs the getRandomValues path.
function randomId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function baseClientId(): string {
  try {
    const key = '__mochi_sync_client_id__';
    let id = localStorage.getItem(key);
    if (!id) {
      id = randomId();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

async function fetchTicket(): Promise<string> {
  const res = await fetch(endpoints().t, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  });
  if (!res.ok) {
    throw new Error(`sync token request failed: ${res.status}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

function mapStatus(state: SyncClientState): Status {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'synced':
      return 'synced';
    case 'disconnected':
      return 'disconnected';
    default:
      return 'connecting';
  }
}

/**
 * A client transport whose socket can be dropped and recreated on demand. Going offline closes and discards the
 * underlying `createWsClientTransport` (so the server session ends and no deltas arrive) without feeding the
 * SyncClient a `disconnect` message — that would trigger reflectdb's own backoff reconnect and fight this control.
 * While offline `send` throws, so `doPush` clears its in-flight marks and the ops stay cleanly pending for the next
 * push after reconnect.
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
      throw new Error('sync connection is offline');
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

class TableState {
  rows = $state<Record<string, unknown>[]>([]);
  status = $state<Status>('connecting');
  pending = $state(0);
  total = $state<number | null>(null);
  refs = 0;
  unsub: (() => void) | null = null;
}

/**
 * One named sync connection: its own SyncClient, WebSocket, clientId, and per-table state. Two connections in the
 * same tab are fully independent, so one can be taken offline and diverge from the other before resyncing.
 */
class SyncConnection {
  private clientId: string;
  private transport: ManagedTransport;
  private client: SyncClient | null = null;
  private ready: Promise<SyncClient> | null = null;
  private tables = new Map<string, TableState>();

  online = $state(true);
  connStatus = $state<Status>('connecting');
  connPending = $state(0);

  constructor(name: string) {
    // Namespace the clientId per connection so reflectdb server sessions and client stores never collide.
    this.clientId = `${baseClientId()}:${name}`;
    this.transport = new ManagedTransport(wsUrl(endpoints().w));
  }

  private ensureReady(): Promise<SyncClient> {
    if (this.ready) {
      return this.ready;
    }
    this.ready = (async () => {
      const token = await fetchTicket();
      const client = new SyncClient({
        clientId: this.clientId,
        transport: this.transport,
        token,
        onReauth: fetchTicket,
        onError: () => this.markError(),
        onSync: () => this.refreshAll(),
      });
      await client.init();
      await client.connect();
      this.client = client;
      this.refreshStatus();
      return client;
    })();
    return this.ready;
  }

  private statusOf(): Status {
    if (!this.online) {
      return 'disconnected';
    }
    return this.client ? mapStatus(this.client.getState()) : 'connecting';
  }

  private refreshTable(table: string): void {
    const state = this.tables.get(table);
    if (!state || !this.client) {
      return;
    }
    state.rows = this.client.getRows(table);
    state.total = this.client.getTotalCount(table);
    state.status = this.statusOf();
    state.pending = this.client.getPendingCount();
  }

  private refreshStatus(): void {
    const status = this.statusOf();
    const pending = this.client?.getPendingCount() ?? 0;
    this.connStatus = status;
    this.connPending = pending;
    for (const state of this.tables.values()) {
      state.status = status;
      state.pending = pending;
    }
  }

  private refreshAll(): void {
    for (const table of this.tables.keys()) {
      this.refreshTable(table);
    }
    this.refreshStatus();
  }

  private markError(): void {
    if (!this.online) {
      return;
    }
    this.connStatus = 'error';
    for (const state of this.tables.values()) {
      state.status = 'error';
    }
  }

  private acquire(table: string, params?: Record<string, unknown>): TableState {
    let state = this.tables.get(table);
    if (!state) {
      state = new TableState();
      this.tables.set(table, state);
    }
    state.refs++;
    const current = state;
    this.ensureReady()
      .then(async (client) => {
        if (!current.unsub) {
          const unsubTable = client.subscribeTable(table, () => this.refreshTable(table));
          const unsubGlobal = client.subscribe(() => this.refreshStatus());
          current.unsub = () => {
            unsubTable();
            unsubGlobal();
          };
        }
        await client.sync(table, params);
        // sync() only declares the subscription; the snapshot arrives on bootstrap. scheduleBootstrap coalesces
        // multiple table subscriptions in the same tick into one bootstrap.
        client.scheduleBootstrap();
        this.refreshTable(table);
      })
      .catch(() => this.markError());
    return state;
  }

  private release(table: string): void {
    const state = this.tables.get(table);
    if (!state) {
      return;
    }
    state.refs--;
    if (state.refs <= 0) {
      state.unsub?.();
      state.unsub = null;
      this.tables.delete(table);
      this.client?.unsync(table).catch(() => {});
    }
  }

  private mutate(fn: (client: SyncClient) => void, table: string, push: boolean): void {
    this.ensureReady()
      .then((client) => {
        fn(client);
        // insert/update/delete only queue a pending op locally — pushSafely transmits it. Skip the push while offline
        // (the send would throw and reflectdb would log it); the queued op ships on the reconnect re-push instead.
        if (push && this.online) {
          void pushSafely(client);
        }
        this.refreshTable(table);
      })
      .catch(() => this.markError());
  }

  setOnline(value: boolean): void {
    if (value === this.online) {
      return;
    }
    if (!value) {
      this.transport.setOnline(false);
      this.online = false;
      this.refreshStatus();
      return;
    }

    this.transport.setOnline(true);
    this.online = true;
    this.refreshStatus();
    // Drive reflectdb's reconnect sequence explicitly: reconnect, re-declare every subscription, pull a fresh
    // snapshot, and push the ops queued while offline. A fresh push (in-flight marks were cleared on the failed
    // offline sends) re-sends everything pending.
    void (async () => {
      const client = this.client ?? (await this.ensureReady());
      try {
        await client.connect();
        await Promise.allSettled([...this.tables.keys()].map((table) => client.sync(table)));
        client.scheduleBootstrap();
        await client.push();
      } catch {
        this.markError();
      }
      this.refreshAll();
    })();
  }

  connection(): MochiSyncConnection {
    // Reactive getters over the connection's $state, plus the offline/online control.
    const self = this;
    return {
      get online() {
        return self.online;
      },
      get status() {
        return self.connStatus;
      },
      get pending() {
        return self.connPending;
      },
      setOnline(value: boolean) {
        self.setOnline(value);
      },
    };
  }

  sync<Row>(table: string, params?: Record<string, unknown>): MochiSyncHandle<Row> {
    const state = this.acquire(table, params);
    let released = false;
    return {
      get rows() {
        return state.rows as unknown as Row[];
      },
      get status() {
        return state.status;
      },
      get pending() {
        return state.pending;
      },
      get total() {
        return state.total;
      },
      insert: (payload, id) => {
        const rowId = id ?? randomId();
        this.mutate((client) => client.insert(table, rowId, payload as Record<string, unknown>), table, true);
        return rowId;
      },
      update: (id, payload) => {
        this.mutate((client) => client.update(table, id, payload as Record<string, unknown>), table, true);
      },
      remove: (id) => {
        this.mutate((client) => client.delete(table, id), table, true);
      },
      loadMore: (count) => {
        this.mutate((client) => void client.loadMore(table, count), table, false);
      },
      destroy: () => {
        if (!released) {
          released = true;
          this.release(table);
        }
      },
    };
  }
}

class SyncRegistry {
  private connections = new Map<string, SyncConnection>();

  get(name: string): SyncConnection {
    let connection = this.connections.get(name);
    if (!connection) {
      connection = new SyncConnection(name);
      this.connections.set(name, connection);
    }
    return connection;
  }
}

function registry(): SyncRegistry {
  return pinGlobal('__mochi_sync_client__', () => new SyncRegistry());
}

/**
 * Subscribe an island to a live sync table. Returns a reactive handle whose `rows`/`status`/`pending`/`total` update
 * as the connection syncs, plus optimistic `insert`/`update`/`remove`/`loadMore` mutators.
 *
 * Pass `{ connection }` to ride a named connection (each name has its own client, socket, and local store, shared per
 * name per tab); omit it for the shared `'default'` connection. reflectdb keys subscriptions by table name, so one
 * params set per table per connection — the last `sync()` call for a table wins its params.
 */
export function sync<Row = Record<string, unknown>>(table: string, params?: Record<string, unknown>, opts?: MochiSyncOptions_Client): MochiSyncHandle<Row> {
  const handle = registry()
    .get(opts?.connection ?? 'default')
    .sync<Row>(table, params);
  try {
    onDestroy(() => handle.destroy());
  } catch {
    // Called outside a component init — the caller owns destroy().
  }
  return handle;
}

/**
 * Control handle for a named sync connection (default `'default'`). Reactive `online`/`status`/`pending`, plus
 * `setOnline(false)` to drop the socket while queuing local writes and `setOnline(true)` to reconnect and resync.
 */
export function syncConnection(name = 'default'): MochiSyncConnection {
  return registry().get(name).connection();
}
