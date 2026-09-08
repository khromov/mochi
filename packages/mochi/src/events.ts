import mitt, { type Emitter, type Handler } from 'mitt';
import { pinGlobal } from './utils/globalState';
import type { MochiEmailResult } from './email/types';

export type MochiRequestKind = 'page' | 'api' | 'file' | 'asset' | 'image' | 'fallback' | 'error';

export interface MochiRequestEvent {
  /**
   * Per-request correlation id, stable across `request`, `error`, `action:invoke`, and `action:complete` for the same HTTP
   * request and also exposed via `getRequestContext().requestId`. Set `proxy.requestIdHeader` to honour an upstream id.
   */
  requestId: string;
  kind: MochiRequestKind;
  method: string;
  path: string;
  status: number;
  duration: number;
  /** True when the request was issued by route warmup. */
  warmup?: boolean;
}

export interface MochiWsOpenEvent {
  path: string;
  duration: number;
}

export interface MochiWsCloseEvent {
  path: string;
  duration: number;
  code: number;
  reason: string;
}

export interface MochiWsMessageEvent {
  path: string;
  size: number;
  type: 'text' | 'binary';
}

export interface MochiSseOpenEvent {
  path: string;
}

export interface MochiSseCloseEvent {
  path: string;
  duration: number;
}

export interface MochiSseMessageEvent {
  path: string;
  size: number;
  event?: string;
}

export type MochiFileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface MochiFileChangeEvent {
  /** Absolute path of the changed file, as reported by the dev watcher. */
  path: string;
  /** Mirrors chokidar's event names. */
  type: MochiFileChangeType;
}

export type MochiIslandErrorKind = 'hydratable' | 'server' | 'client-hydrate';

export interface MochiIslandErrorEvent {
  componentName: string;
  islandId: string | undefined;
  kind: MochiIslandErrorKind;
  message: string;
  /** Stack trace — populated only in development builds. */
  stack?: string;
}

export type MochiCaptchaReason = 'ok' | 'malformed' | 'expired' | 'too-fast' | 'bad-pow' | 'replay';

export interface MochiCaptchaVerifyEvent {
  ok: boolean;
  /** The real cause, for operators: `verifyCaptcha()` returns one generic message to the client so a bot can't probe for the limits, leaving this the only place the distinction survives. */
  reason: MochiCaptchaReason;
  /** Difficulty sealed in the token. Absent when the token never opened. */
  bits?: number;
  /** Token age at verification. Absent when the token never opened. */
  ageMs?: number;
}

export type MochiCacheStatus = 'fresh' | 'stale' | 'expired' | 'miss';

export interface MochiCacheReadEvent {
  key: string;
  status: MochiCacheStatus;
}

export interface MochiCacheRevalidateEvent {
  key: string;
}

export interface MochiCacheInflightDeferredEvent {
  key: string;
}

export interface MochiCacheDeleteEvent {
  key: string;
}

/** Emitted the moment the OS reports low memory, before Mochi drains its caches — subscribe to give other resources
 * back (idle connections, worker pools). The cache drain's own result rides the separate `cache:pressure`. */
export interface MochiMemoryPressureEvent {
  /** `'critical'` means the OS is about to start killing processes; only macOS also reports `'warning'`. */
  level: 'warning' | 'critical';
}

/** Emitted when the OS reports low memory and Mochi drains its in-memory caches in response. */
export interface MochiCachePressureEvent {
  /** `'critical'` means the OS is about to start killing processes; only macOS also reports `'warning'`. */
  level: 'warning' | 'critical';
  /** Entries reclaimed: aged-out ones at `'warning'`, all of them at `'critical'`. */
  removed: number;
  /** How many in-memory caches responded. */
  caches: number;
  durationMs: number;
}

export interface MochiCacheSweepEvent {
  /** Expired entries deleted by this sweep. */
  removed: number;
  durationMs: number;
}

/** Counts always reconcile: `removedVariants + removedOriginals + removedOther` equals the total the storage backend reported removing. */
export interface MochiImageCacheSweepEvent {
  /** Resized variants and blur placeholders deleted (original evicted, missing, or superseded by a newer generation). */
  removedVariants: number;
  /** Full-size originals deleted, past their evict window. */
  removedOriginals: number;
  /**
   * Removed files other than image entries: transient `mochi:inflight:` coalescing markers, in-flight `.tmp` writes,
   * corrupt/legacy files, and every removal from a custom backend that reports no swept keys.
   */
  removedOther: number;
  durationMs: number;
}

export type MochiImageEntryKind = 'original' | 'variant' | 'placeholder';

export interface MochiImageStoreEvent {
  kind: MochiImageEntryKind;
  /** The image source, a URL or a key. */
  src: string;
  /** Absolute path of the file just committed to the image cache on disk. */
  path: string;
  /** The `variantId` for `variant`; `originalId(src)` for `original`/`placeholder`. */
  id: string;
  /** Bytes written to disk. */
  size: number;
  /** Authoritative content type; `''` for `placeholder`. */
  contentType: string;
  /** Pixel width; `0` for `original` (never decoded) and `placeholder`. */
  width: number;
  /** Pixel height; `0` for `original` and `placeholder`. */
  height: number;
  /** Encoded format (e.g. `'webp'`); `''` for `original` and `placeholder`. */
  format: string;
}

export type MochiImageDeleteReason = 'evicted' | 'superseded' | 'invalidated';

export interface MochiImageDeleteEvent {
  kind: MochiImageEntryKind;
  src: string;
  /** Absolute path of the file removed from the cache. */
  path: string;
  /** Same id scheme as `MochiImageStoreEvent.id`. */
  id: string;
  /** Bytes reclaimed from disk; `0` when the file was already gone. */
  size: number;
  /** `evicted` = past its window (sweep); `superseded` = a newer generation replaced it; `invalidated` = explicit invalidate call. */
  reason: MochiImageDeleteReason;
}

export interface MochiCacheRevalidateFailedEvent {
  key: string;
  /** The error thrown by the background revalidation function. */
  error: unknown;
}

export interface MochiCacheErrorEvent {
  key: string;
  /** Which storage operation threw. */
  operation: 'get' | 'set' | 'remove' | 'clear';
  error: unknown;
}

export interface MochiQueueAddedEvent {
  queue: string;
  jobId: string;
  /** True when this add came from an `addBulk` call — see `queue:addedBulk` for the one-per-call summary. */
  bulk?: boolean;
}

/** Emitted once per `addBulk` call that inserted at least one job, alongside the per-job `queue:added` events. */
export interface MochiQueueAddedBulkEvent {
  queue: string;
  /** Jobs actually inserted (duplicates by explicit id are skipped). */
  count: number;
  jobIds: string[];
}

export interface MochiQueueActiveEvent {
  queue: string;
  jobId: string;
  /** 1-based attempt number (1 on the first run). */
  attempt: number;
}

export interface MochiQueueCompletedEvent {
  queue: string;
  jobId: string;
  attempt: number;
  /** Milliseconds the processor ran for this attempt. */
  duration: number;
}

export interface MochiQueueFailedEvent {
  queue: string;
  jobId: string;
  attempt: number;
  duration: number;
  /** Message of the error the processor threw. */
  error: string;
}

/**
 * Emitted once per cron job when `Mochi.serve({ cron })` registers it. A durable cron run is a queue job named
 * after the cron, so its run lifecycle surfaces through `queue:active` / `queue:completed` / `queue:failed`.
 */
export interface MochiCronScheduledEvent {
  /** The cron job's name. */
  job: string;
  schedule: string;
  /** IANA zone the schedule is read in; absent when using the system zone. */
  tz?: string;
  /** Epoch ms of the next fire; absent when none could be computed. */
  nextRun?: number;
}

export interface MochiQueueErrorEvent {
  /** Absent for instance-level bun-boss errors, which carry no queue attribution. */
  queue?: string;
  error: string;
}

export interface MochiEmailSentEvent {
  to: string[];
  subject: string;
  transport: MochiEmailResult['transport'];
  /** Provider/SMTP message id, when the transport returns one. */
  messageId?: string;
  /** Wall-clock milliseconds. */
  duration: number;
}

export interface MochiEmailErrorEvent {
  to: string[];
  /** Carried so the console logger can scrub them from the error string under `filterPii: true`, since a transport error may echo a bcc address. */
  cc?: string[];
  bcc?: string[];
  subject: string;
  transport: MochiEmailResult['transport'];
  /** Message of the error the transport threw. */
  error: string;
}

export interface MochiServerStartEvent {
  /** Bound TCP port; absent when serving over a Unix socket. */
  port?: number;
  hostname?: string;
  development: boolean;
  routes: { page: number; api: number; ws: number; sse: number; file: number };
}

export interface MochiServerStopEvent {
  /** `'signal'` for SIGTERM/SIGINT, `'stop'` for a programmatic `Mochi.stop()`. */
  reason: 'signal' | 'stop';
  signal?: 'SIGTERM' | 'SIGINT';
}

export interface MochiWarmupStartEvent {
  /** Static page routes about to be warmed (no `:param` or `*` segments). */
  routeCount: number;
}

export interface MochiWarmupCompleteEvent {
  /** Static page routes that were warmed (no `:param` or `*` segments). */
  routeCount: number;
  /** How many warmup invocations threw or returned a 5xx response. */
  errorCount: number;
  durationMs: number;
}

export interface MochiDictionaryReadyEvent {
  /** Lowercase hex SHA-256 of the dictionary — also its `/_mochi/dictionary/:hash` URL segment. */
  hash: string;
  sizeBytes: number;
  /** Static page routes whose HTML was harvested into the dictionary. */
  routeCount: number;
  durationMs: number;
}

export type MochiErrorKind = 'page' | 'api' | 'action' | 'file';

export interface MochiErrorEvent {
  /** Same `requestId` as the surrounding `request` event. */
  requestId: string;
  kind: MochiErrorKind;
  path: string;
  method: string;
  status: number;
  message: string;
  /** Stack trace — populated only in development builds. */
  stack?: string;
  /** Form action name — present only when `kind === 'action'`. */
  actionName?: string;
}

export type MochiActionResult = 'success' | 'fail' | 'redirect' | 'error';

export interface MochiActionInvokeEvent {
  /** Same `requestId` as the surrounding `request` event. */
  requestId: string;
  path: string;
  actionName: string;
}

export interface MochiActionCompleteEvent {
  /** Same `requestId` as the matching `action:invoke`. */
  requestId: string;
  path: string;
  actionName: string;
  result: MochiActionResult;
  /** HTTP status — set for `fail` and `redirect`; absent for `success` and `error` (the `error` event carries the status). */
  status?: number;
}

export interface MochiCompileStartEvent {
  /** Absolute path of the `.svelte` file about to be compiled. */
  path: string;
}

export interface MochiCompileCompleteEvent {
  /** Absolute path of the compiled `.svelte` file. */
  path: string;
  ssrSizeBytes: number;
  hydratableCount: number;
  serverIslandCount: number;
  /** Milliseconds spent inside `ComponentRegistry.compile()`. */
  durationMs: number;
}

export type MochiRecompileTrigger = 'file' | 'css' | 'svelte-config' | 'html-shell' | 'entry';

export interface MochiRecompileStartEvent {
  trigger: MochiRecompileTrigger;
  /** Path of the file whose change triggered the rebuild. */
  path: string;
  /** Pages about to be recompiled. `0` for the CSS fast-path. */
  pageCount: number;
}

export interface MochiRecompileCompleteEvent {
  trigger: MochiRecompileTrigger;
  path: string;
  pageCount: number;
  /** Absolute paths of the page entries recompiled this cycle. */
  pages: string[];
  /** `buildClientBundle()` calls that ran during this cycle. */
  clientBundleCount: number;
  durationMs: number;
}

export interface MochiRecompileModuleChurnEvent {
  /** How many times the entry has been re-imported this dev session. */
  reloadCount: number;
}

export interface MochiClientBundleEvent {
  /** Entrypoints fed to `Bun.build` (HydratableIsland + per-component virtuals). */
  entryCount: number;
  /** Sum of output sizes (JS + CSS) reported by Bun's metafile. */
  outputBytes: number;
  durationMs: number;
}

export interface MochiCompileBatchCompleteEvent {
  count: number;
  /** Covers `Bun.build` plus post-build processing. */
  durationMs: number;
}

export interface MochiPreprocessCacheEvent {
  /** Absolute path of the `.svelte` file the cache wrapper was invoked for. */
  filePath: string;
}

export interface MochiPreprocessCacheSummaryEvent {
  hits: number;
  misses: number;
  /** Total file lookups during the batch (`hits + misses`). */
  files: number;
}

export interface MochiCompileCacheSummaryEvent {
  hits: number;
  misses: number;
  /** Total file lookups during the batch (`hits + misses`). */
  files: number;
}

export interface MochiCompileErrorLog {
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface MochiCompileErrorEvent {
  /** Absolute path of the `.svelte` file that failed to build. */
  path: string;
  message: string;
  logs: MochiCompileErrorLog[];
}

export type MochiEventMap = {
  request: MochiRequestEvent;
  'ws:open': MochiWsOpenEvent;
  'ws:message': MochiWsMessageEvent;
  'ws:close': MochiWsCloseEvent;
  'sse:open': MochiSseOpenEvent;
  'sse:message': MochiSseMessageEvent;
  'sse:close': MochiSseCloseEvent;
  'file:change': MochiFileChangeEvent;
  'island:error': MochiIslandErrorEvent;
  'captcha:verify': MochiCaptchaVerifyEvent;
  'cache:read': MochiCacheReadEvent;
  'cache:revalidate': MochiCacheRevalidateEvent;
  'cache:inflight:deferred': MochiCacheInflightDeferredEvent;
  'cache:delete': MochiCacheDeleteEvent;
  'cache:sweep': MochiCacheSweepEvent;
  'memory:pressure': MochiMemoryPressureEvent;
  'cache:pressure': MochiCachePressureEvent;
  'image:cache-sweep': MochiImageCacheSweepEvent;
  'image:store': MochiImageStoreEvent;
  'image:delete': MochiImageDeleteEvent;
  'cache:revalidate:failed': MochiCacheRevalidateFailedEvent;
  'cache:error': MochiCacheErrorEvent;
  'queue:added': MochiQueueAddedEvent;
  'queue:addedBulk': MochiQueueAddedBulkEvent;
  'queue:active': MochiQueueActiveEvent;
  'queue:completed': MochiQueueCompletedEvent;
  'queue:failed': MochiQueueFailedEvent;
  'queue:error': MochiQueueErrorEvent;
  'cron:scheduled': MochiCronScheduledEvent;
  'email:sent': MochiEmailSentEvent;
  'email:error': MochiEmailErrorEvent;
  'server:start': MochiServerStartEvent;
  'server:stop': MochiServerStopEvent;
  'warmup:start': MochiWarmupStartEvent;
  'warmup:complete': MochiWarmupCompleteEvent;
  'dictionary:ready': MochiDictionaryReadyEvent;
  error: MochiErrorEvent;
  'action:invoke': MochiActionInvokeEvent;
  'action:complete': MochiActionCompleteEvent;
  'compile:start': MochiCompileStartEvent;
  'compile:complete': MochiCompileCompleteEvent;
  'compile:batch-complete': MochiCompileBatchCompleteEvent;
  'compile:error': MochiCompileErrorEvent;
  'preprocess-cache:hit': MochiPreprocessCacheEvent;
  'preprocess-cache:miss': MochiPreprocessCacheEvent;
  'preprocess-cache:summary': MochiPreprocessCacheSummaryEvent;
  'compile-cache:summary': MochiCompileCacheSummaryEvent;
  'recompile:start': MochiRecompileStartEvent;
  'recompile:complete': MochiRecompileCompleteEvent;
  'recompile:module-churn': MochiRecompileModuleChurnEvent;
  'client-bundle:complete': MochiClientBundleEvent;
};

export interface MochiEmitter extends Emitter<MochiEventMap> {
  /**
   * Register `handler` under `name`, replacing any handler previously registered under that name across any event type.
   * Prefer this over `.on()` when subscribing from a module that may be bundled into an SSR island: the dev compile cache
   * re-imports those bundles on every `.svelte` change, and naive `.on()` calls pile up one subscriber per re-import.
   *
   * Namespace `name` (e.g. `"docs:cache-clear"`), since two callers picking the same name silently evict each other.
   * Pair it with `removeHandler`, which keeps the name table in step; a bare `.off()` leaves a stale entry behind.
   */
  setHandler<K extends keyof MochiEventMap>(name: string, type: K, handler: (event: MochiEventMap[K]) => void): void;

  /** The counterpart to `setHandler`: unregisters `name`'s handler and drops it from the table, so a per-instance subscriber releases it at teardown. No-op for an unknown `name`. */
  removeHandler(name: string): void;
}

// TODO: Check if this is still needed since we fixed the bundling duplication
// Bun's bundler gives each compiled bundle its own `mitt()`, so subscribers registered through one copy miss events
// emitted by another; pinning the emitter globally keeps the server runtime and every bundled copy on one instance.
export const mochiEvents: MochiEmitter = pinGlobal<MochiEmitter>('__mochi_events__', () => {
  const base = mitt<MochiEventMap>() as MochiEmitter;
  const byName = new Map<string, { type: keyof MochiEventMap; handler: Handler<MochiEventMap[keyof MochiEventMap]> }>();
  base.setHandler = (name, type, handler) => {
    const prior = byName.get(name);
    if (prior) {
      // The name table erases K, so the cast restores what mitt's per-event-type off() expects.
      base.off(prior.type, prior.handler as never);
    }
    byName.set(name, {
      type,
      handler: handler as Handler<MochiEventMap[keyof MochiEventMap]>,
    });
    base.on(type, handler);
  };
  base.removeHandler = (name) => {
    const prior = byName.get(name);
    if (!prior) {
      return;
    }
    base.off(prior.type, prior.handler as never);
    byName.delete(name);
  };
  return base;
});

/**
 * `true` when at least one handler is registered for `name`, so payload construction can be skipped for expensive events.
 *
 * ```ts
 * if (hasSubscribers('compile:error')) {
 *   mochiEvents.emit('compile:error', { ...buildLogs(...) });
 * }
 * ```
 *
 * It's cheap and synchronous, so reach for it whenever the payload involves loops, allocations, or stack capture.
 */
export function hasSubscribers(name: keyof MochiEventMap): boolean {
  return (mochiEvents.all.get(name)?.length ?? 0) > 0;
}
