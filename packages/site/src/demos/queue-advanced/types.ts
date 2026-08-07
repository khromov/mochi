// Pure types shared between the server module (queueAdvanced.server.ts) and the island.
// Components must import types from here, NOT from the server module: a type import
// from a side-effectful server module still drags that module into the SSR
// component bundle, instantiating its workers/state a second time.

export type WebhookMode = 'ok' | 'flaky' | 'doomed';

export interface WebhookJob {
  url: string;
  mode: WebhookMode;
  priority?: number;
}

export interface DigestJob {
  requestedAt: number;
}

export type DemoLogKind = 'added' | 'active' | 'completed' | 'failed' | 'dlq' | 'suppressed' | 'redrive' | 'info';

export interface DemoLogEntry {
  id: number;
  at: number;
  kind: DemoLogKind;
  queue: string;
  jobId?: string;
  attempt?: number;
  detail: string;
}

export interface QueueAdvancedStatus {
  /** Which queueStorage the server booted with — memory, sqlite, or postgres. */
  storage: string;
  dlqDepth: number;
  log: DemoLogEntry[];
}
