// Pure types shared between the server module (queue.server.ts) and the island.
// Components must import types from here, NOT from queue.server.ts: a type import
// from a side-effectful server module still drags that module into the SSR
// component bundle, instantiating its worker/state a second time.

export interface ProcessedEntry {
  user: string;
  at: number;
  ms: number;
}

export interface QueueStatus {
  processed: ProcessedEntry[];
  processedTotal: number;
  inFlight: number;
}
