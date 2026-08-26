import type { MochiSyncHandle } from './types';

/**
 * Server-side inert stub for `sync()`. Islands run their top-level code during SSR, so this must never throw — it
 * returns an empty, frozen handle. The real reactive client only runs after hydration in the browser (see
 * `sync.client.svelte.ts`), so an island shows empty rows server-side until it connects.
 */
export function sync<Row = Record<string, unknown>>(_table: string, _params?: Record<string, unknown>): MochiSyncHandle<Row> {
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
