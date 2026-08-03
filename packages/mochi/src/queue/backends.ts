import type { MessageQueue } from '@fedify/fedify';
import type { Database } from 'bun:sqlite';
import type { Sql } from 'postgres';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pinGlobal } from '../utils/globalState';
import { MemoryMessageQueue } from './memoryQueue';

/**
 * Where a queue's messages live. `'memory'` (the default) is in-process and lost on restart; `sqlite` / `postgres`
 * persist through the fedify drivers; any object implementing fedify's `MessageQueue` (Redis, AMQP, a custom driver)
 * plugs in directly. The `fedify` object is the escape hatch: it is spread verbatim over the options Mochi passes to
 * the driver constructor, so any `SqliteMessageQueueOptions` / `PostgresMessageQueueOptions` field can be overridden.
 */
export type MochiQueueBackend = 'memory' | { sqlite: string; fedify?: Record<string, unknown> } | { postgres: string; fedify?: Record<string, unknown> } | MessageQueue;

interface BackendRegistry {
  /** Shared `bun:sqlite` handles keyed by resolved db path — one file can back many queues (one table each). */
  sqliteDbs: Map<string, Database>;
  /** Shared postgres.js clients keyed by connection URL. */
  postgresSql: Map<string, Sql>;
  /** Sanitized table name → queue name, to reject two queue names that collapse to the same table. */
  tableNames: Map<string, string>;
  /** User-provided raw instances; a second queue on the same instance would steal its sibling's messages. */
  rawInstances: Set<MessageQueue>;
  memoryQueues: Set<MemoryMessageQueue>;
}

// Pinned for the same reason as the queue registry: shutdown must find every handle whichever bundled copy created it.
const backendRegistry = pinGlobal<BackendRegistry>('__mochi_queue_backends__', () => ({
  sqliteDbs: new Map(),
  postgresSql: new Map(),
  tableNames: new Map(),
  rawInstances: new Set(),
  memoryQueues: new Set(),
}));

function isMessageQueueInstance(value: unknown): value is MessageQueue {
  return typeof value === 'object' && value !== null && typeof (value as MessageQueue).enqueue === 'function' && typeof (value as MessageQueue).listen === 'function';
}

function tableNameFor(queueName: string): string {
  const tableName = `mochi_queue_${queueName.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const prior = backendRegistry.tableNames.get(tableName);
  if (prior !== undefined && prior !== queueName) {
    throw new Error(`Queue "${queueName}" and queue "${prior}" both map to backend table "${tableName}". Rename one so the sanitized names (letters, digits, underscores) differ.`);
  }
  backendRegistry.tableNames.set(tableName, queueName);
  return tableName;
}

export interface ResolvedBackend {
  queue: MessageQueue;
}

/**
 * Resolve a `MochiQueueBackend` to a live fedify `MessageQueue` for one named queue. Driver packages are imported
 * lazily so an app that never touches sqlite/postgres pays nothing for them. Store DDL runs here (`initialize()`)
 * so a bad path or unreachable database fails the mount, not the first job — postgres.js in particular never opens a
 * connection until the first query.
 */
export async function resolveBackend(queueName: string, backend: MochiQueueBackend | undefined): Promise<ResolvedBackend> {
  if (backend === undefined || backend === 'memory') {
    const queue = new MemoryMessageQueue();
    backendRegistry.memoryQueues.add(queue);
    return { queue };
  }

  if (isMessageQueueInstance(backend)) {
    if (backendRegistry.rawInstances.has(backend)) {
      throw new Error(
        `Queue "${queueName}": this MessageQueue instance already backs another queue. A raw instance supports a single listener — construct one instance per queue.`,
      );
    }
    backendRegistry.rawInstances.add(backend);
    return { queue: backend };
  }

  if ('sqlite' in backend) {
    const [{ SqliteMessageQueue }, { Database: SqliteDatabase }] = await Promise.all([import('@fedify/sqlite'), import('bun:sqlite')]);
    const dbPath = path.resolve(backend.sqlite);
    let db = backendRegistry.sqliteDbs.get(dbPath);
    if (!db) {
      mkdirSync(path.dirname(dbPath), { recursive: true });
      db = new SqliteDatabase(dbPath);
      backendRegistry.sqliteDbs.set(dbPath, db);
    }
    // tsc resolves the driver's `#sqlite` import map to the node:sqlite types (the "bun" condition only applies at
    // runtime, where it takes a bun:sqlite Database — verified empirically), hence the cast.
    const platformDb = db as unknown as ConstructorParameters<typeof SqliteMessageQueue>[0];
    // The driver's 5s pollInterval default is tuned for federation traffic; 500ms keeps local jobs snappy.
    const queue = new SqliteMessageQueue(platformDb, {
      tableName: tableNameFor(queueName),
      pollInterval: { milliseconds: 500 },
      ...backend.fedify,
    });
    if (backend.fedify?.initialized !== true) {
      queue.initialize();
    }
    return { queue };
  }

  if ('postgres' in backend) {
    const [{ PostgresMessageQueue }, { default: postgres }] = await Promise.all([import('@fedify/postgres'), import('postgres')]);
    let sql = backendRegistry.postgresSql.get(backend.postgres);
    if (!sql) {
      sql = postgres(backend.postgres);
      backendRegistry.postgresSql.set(backend.postgres, sql);
    }
    const tableName = tableNameFor(queueName);
    // Per-queue channel: the driver default is one shared NOTIFY channel, which would wake every queue on any enqueue.
    const queue = new PostgresMessageQueue(sql, {
      tableName,
      channelName: `${tableName}_channel`,
      ...backend.fedify,
    } as ConstructorParameters<typeof PostgresMessageQueue>[1]);
    if (backend.fedify?.initialized !== true) {
      await queue.initialize();
    }
    return { queue };
  }

  throw new Error(`Queue "${queueName}": unrecognized backend ${JSON.stringify(backend)}. Use 'memory', { sqlite: path }, { postgres: url }, or a MessageQueue instance.`);
}

/**
 * Close every backend resource Mochi itself opened — memory queues (their delay timers hold the process open), shared
 * sqlite handles, shared postgres clients — and reset the maps so a fresh mount in this process starts clean.
 * User-provided raw `MessageQueue` instances are deliberately not closed: Mochi didn't open them.
 */
export async function closeBackendResources(): Promise<void> {
  for (const queue of backendRegistry.memoryQueues) {
    queue.close();
  }
  const sqliteDbs = [...backendRegistry.sqliteDbs.values()];
  if (sqliteDbs.length > 0) {
    // The sqlite driver's enqueue notification spawns fire-and-forget polls that the awaited listen() promise does not
    // cover, and its SQLITE_BUSY retry ladder can keep one asleep for ~3.1s; closing the handle under such a straggler
    // throws an uncatchable rejection. Close only after the ladder has fully run out — unref'd, so process exit is
    // never held up (the OS reclaims the handle at exit anyway, and WAL recovers on the next open).
    const close = setTimeout(() => {
      for (const db of sqliteDbs) {
        try {
          db.close();
        } catch {
          // Already closed; shutdown must not throw.
        }
      }
    }, 4000);
    close.unref?.();
  }
  await Promise.allSettled([...backendRegistry.postgresSql.values()].map((sql) => sql.end({ timeout: 5 })));
  backendRegistry.memoryQueues.clear();
  backendRegistry.sqliteDbs.clear();
  backendRegistry.postgresSql.clear();
  backendRegistry.tableNames.clear();
  backendRegistry.rawInstances.clear();
}
