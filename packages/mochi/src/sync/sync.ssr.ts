import type { MochiSyncConnection, MochiSyncHandle, MochiSyncOptions_Client } from './types';

/**
 * Server-side inert stubs for `sync()` / `syncConnection()`. Islands run their top-level code during SSR, so these
 * must never throw — they return empty, inert handles. The real reactive client only runs after hydration in the
 * browser (see `sync.client.svelte.ts`), so an island shows empty rows server-side until it connects.
 */
export function sync<Row = Record<string, unknown>>(_table: string, _params?: Record<string, unknown>, _opts?: MochiSyncOptions_Client): MochiSyncHandle<Row> {
  return {
    rows: [] as Row[],
    status: 'connecting',
    pending: 0,
    total: null,
    insert: () => crypto.randomUUID(),
    update: () => {},
    remove: () => {},
    loadMore: () => {},
    destroy: () => {},
  };
}

export function syncConnection(_name = 'default'): MochiSyncConnection {
  return {
    online: true,
    status: 'connecting',
    pending: 0,
    setOnline: () => {},
  };
}
