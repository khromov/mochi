import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createPostgresStorage, createSqliteStorage } from 'reflectdb/server';
import type { StorageAdapter } from 'reflectdb/server';
import type { MochiSyncStorage } from './types';

export interface SyncStorageHandle {
  /** `undefined` for `'memory'` — reflectdb keeps its op log in-process. */
  adapter: StorageAdapter | undefined;
  close(): Promise<void>;
}

/**
 * Build the reflectdb storage adapter for the configured store. `'memory'` uses reflectdb's built-in in-process log
 * (no adapter). A sqlite file's parent directory is created first, mirroring the queue's `constructBoss`. Postgres is
 * fed a Bun `SQL` connection adapted to reflectdb's `$1`-placeholder `PostgresClient` interface.
 */
export function createSyncStorage(storage: MochiSyncStorage): SyncStorageHandle {
  if (storage === 'memory') {
    return { adapter: undefined, close: async () => {} };
  }

  if ('sqlite' in storage) {
    const file = storage.sqlite;
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const adapter = createSqliteStorage({ path: file });
    return {
      adapter,
      close: async () => {
        adapter.close();
      },
    };
  }

  const sql = new SQL(storage.postgres);
  const adapter = createPostgresStorage({
    client: {
      query: async (text: string, values?: unknown[]) => ({ rows: (await sql.unsafe(text, values ?? [])) as unknown as never[] }),
    },
  });
  return {
    adapter,
    close: async () => {
      adapter.close();
      await sql.close();
    },
  };
}
