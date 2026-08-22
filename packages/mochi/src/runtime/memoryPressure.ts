import { mochiEvents } from '../events';
import type { MochiEventMap } from '../events';
import { logger } from '../utils/log';
import { pinGlobal } from '../utils/globalState';

/**
 * `'warning'` means the OS would like memory back; `'critical'` means it is about to start killing processes. Only
 * macOS distinguishes the two — Linux and Windows report `'critical'` only.
 */
export type MemoryPressureLevel = 'warning' | 'critical';

/** A cache that can give memory back. `sweep` drops what is already stale; `clear` drops everything. */
export interface PressureResponder {
  /** Identifies the responder in the `cache:pressure` event and log line. */
  readonly pressureLabel: string;
  /** Entries currently held, so the event can report what a clear reclaimed. */
  count(): number;
  sweep(): { removed: number };
  clear(): void;
}

interface PressureRegistry {
  /** Weak, so registering a cache never keeps it alive — a dropped cache is pruned on the next pass. */
  responders: Set<WeakRef<PressureResponder>>;
  handler: ((level: MemoryPressureLevel) => void) | null;
}

const registry = pinGlobal<PressureRegistry>('__mochi_pressure_registry__', () => ({ responders: new Set(), handler: null }));

export function registerPressureResponder(responder: PressureResponder): void {
  // Pruning here too bounds the set in the common case: the OS signal never fires on a healthy Linux box (and never at
  // all in dev or a build), so registration is the only pass a short-lived cache would otherwise get.
  prune();
  registry.responders.add(new WeakRef(responder));
}

function prune(): void {
  for (const ref of registry.responders) {
    if (!ref.deref()) {
      registry.responders.delete(ref);
    }
  }
}

function liveResponders(): PressureResponder[] {
  const alive: PressureResponder[] = [];
  for (const ref of registry.responders) {
    const responder = ref.deref();
    if (responder) {
      alive.push(responder);
    } else {
      registry.responders.delete(ref);
    }
  }
  return alive;
}

/**
 * Reclaim what the level warrants: `'warning'` drops only aged-out entries, `'critical'` drops everything, because at
 * that point the kernel is choosing between this cache and the process.
 */
export function respondToPressure(level: MemoryPressureLevel): { level: MemoryPressureLevel; removed: number; caches: number; durationMs: number } {
  const start = Date.now();
  // Broadcast the raw signal before the cache drain, so unregistered subsystems (connection pools, worker queues, user
  // code) can reclaim their own resources too.
  emitSafely('memory:pressure', { level });
  const responders = liveResponders();
  let removed = 0;
  for (const responder of responders) {
    try {
      if (level === 'critical') {
        removed += responder.count();
        responder.clear();
      } else {
        removed += responder.sweep().removed;
      }
    } catch (err) {
      logger.warn(`Memory-pressure ${level} response failed for ${responder.pressureLabel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const result = { level, removed, caches: responders.length, durationMs: Date.now() - start };
  emitSafely('cache:pressure', result);
  return result;
}

// mitt does not catch, and this runs inside a `process.on` listener, so a throwing subscriber would become an
// uncaughtException — killing the process at the exact moment the OS was trying not to.
function emitSafely<K extends 'memory:pressure' | 'cache:pressure'>(event: K, payload: MochiEventMap[K]): void {
  try {
    mochiEvents.emit(event, payload);
  } catch (err) {
    logger.warn(`Memory-pressure "${event}" listener threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Subscribe to the OS low-memory notification. Idempotent, so repeated `Mochi.serve()` calls install one handler. */
export function installMemoryPressureHandler(): void {
  if (registry.handler) {
    return;
  }
  const handler = (level: MemoryPressureLevel): void => void respondToPressure(level);
  registry.handler = handler;
  process.on('memoryPressure', handler);
}

export function removeMemoryPressureHandler(): void {
  if (!registry.handler) {
    return;
  }
  process.off('memoryPressure', registry.handler);
  registry.handler = null;
}
