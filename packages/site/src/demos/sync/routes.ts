import { Mochi, getRequestContext } from 'mochi-framework';
import { defineSync } from 'mochi-framework/sync';
import type { MochiRouteValue } from 'mochi-framework';
import { queries, type Todo } from './schema';

// A per-server in-memory store keyed by table. Real apps back this with a database; a Map keeps the demo self-contained.
const todos = new Map<string, Todo>();

function isValidTodo(payload: Record<string, unknown> | null): payload is Partial<Todo> {
  if (!payload) {
    return false;
  }
  if ('text' in payload && typeof payload.text !== 'string') {
    return false;
  }
  if ('done' in payload && typeof payload.done !== 'boolean') {
    return false;
  }
  return true;
}

export const sync = defineSync({
  queries,
  db: todos,
  auth: (): { userId: string } | null => {
    const userId = getRequestContext().cookies.get('mochi-sync-user');
    return userId ? { userId } : null;
  },
  tables: {
    todos: {
      query: (_ctx, db) => [...db.values()],
      mutate: async (op, _ctx, db) => {
        if (op.type === 'delete') {
          db.delete(op.rowId);
          return;
        }
        // `t<Todo>()` is compile-time only — validate the payload before writing.
        if (!isValidTodo(op.payload)) {
          return;
        }
        const existing = db.get(op.rowId) ?? { id: op.rowId, text: '', done: false };
        db.set(op.rowId, { ...existing, ...op.payload, id: op.rowId });
      },
    },
  },
});

export const routes: Record<string, MochiRouteValue> = {
  '/demos/sync': Mochi.page('./src/demos/sync/SyncDemo.svelte', {
    serverProps: () => {
      // Assign a stable per-visitor id so the sync auth callback has a cookie to read.
      const { cookies } = getRequestContext();
      if (!cookies.get('mochi-sync-user')) {
        cookies.set('mochi-sync-user', crypto.randomUUID(), { path: '/', maxAge: 604800, sameSite: 'lax' });
      }
      return {};
    },
  }),
};
