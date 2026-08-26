import { onDestroy } from 'svelte';
import { SyncClient, pushSafely } from 'reflectdb/client';
import type { SyncClientState } from 'reflectdb/client';
import { createWsClientTransport } from 'reflectdb/transport/ws';
import { pinGlobal } from '../utils/globalState';
import type { MochiSyncHandle } from './types';

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
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadClientId(): string {
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

class TableState {
  rows = $state<Record<string, unknown>[]>([]);
  status = $state<Status>('connecting');
  pending = $state(0);
  total = $state<number | null>(null);
  refs = 0;
  unsub: (() => void) | null = null;
}

class SyncManager {
  private clientId = loadClientId();
  private client: SyncClient | null = null;
  private ready: Promise<SyncClient> | null = null;
  private tables = new Map<string, TableState>();

  private ensureReady(): Promise<SyncClient> {
    if (this.ready) {
      return this.ready;
    }
    this.ready = (async () => {
      const token = await fetchTicket();
      const transport = createWsClientTransport({ url: wsUrl(endpoints().w) });
      const client = new SyncClient({
        clientId: this.clientId,
        transport,
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

  private refreshTable(table: string): void {
    const state = this.tables.get(table);
    if (!state || !this.client) {
      return;
    }
    state.rows = this.client.getRows(table);
    state.total = this.client.getTotalCount(table);
    state.status = mapStatus(this.client.getState());
    state.pending = this.client.getPendingCount();
  }

  private refreshStatus(): void {
    if (!this.client) {
      return;
    }
    const status = mapStatus(this.client.getState());
    const pending = this.client.getPendingCount();
    for (const state of this.tables.values()) {
      state.status = status;
      state.pending = pending;
    }
  }

  private refreshAll(): void {
    for (const table of this.tables.keys()) {
      this.refreshTable(table);
    }
  }

  private markError(): void {
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
        if (push) {
          // insert/update/delete only queue a pending op locally — pushSafely transmits it (and coalesces bursts).
          void pushSafely(client);
        }
        this.refreshTable(table);
      })
      .catch(() => this.markError());
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

function manager(): SyncManager {
  return pinGlobal('__mochi_sync_client__', () => new SyncManager());
}

/**
 * Subscribe an island to a live sync table. Returns a reactive handle whose `rows`/`status`/`pending`/`total` update
 * as the shared per-tab client syncs, plus optimistic `insert`/`update`/`remove`/`loadMore` mutators.
 *
 * v1 limitation: reflectdb keys subscriptions by table name, so one params set per table per tab — the last `sync()`
 * call for a table wins its params.
 */
export function sync<Row = Record<string, unknown>>(table: string, params?: Record<string, unknown>): MochiSyncHandle<Row> {
  const handle = manager().sync<Row>(table, params);
  try {
    onDestroy(() => handle.destroy());
  } catch {
    // Called outside a component init — the caller owns destroy().
  }
  return handle;
}
