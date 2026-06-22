// Pure types shared between the server module (queue.server.ts) and the island.
// Components must import types from here, NOT from queue.server.ts: a type import
// from a side-effectful server module still drags that module into the SSR
// component bundle, instantiating its worker/state a second time.

export interface NotificationJob {
  user: string;
}

export interface ProcessedEntry {
  user: string;
  at: number;
}

export interface QueueStatus {
  /** Global, server-owned snapshot broadcast to every client — all browsers see the same numbers. */
  processed: ProcessedEntry[];
  processedTotal: number;
  /** Jobs enqueued but not yet completed, across all clients. */
  inFlight: number;
}
