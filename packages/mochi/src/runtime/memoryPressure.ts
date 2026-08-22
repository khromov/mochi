import { mochiEvents } from '../events';
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
  registry.responders.add(new WeakRef(responder));
}

/** Live responders, dropping refs whose target has been collected. */
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
  // Broadcast the raw signal before the cache drain, so subsystems that aren't registered caches (connection pools,
  // worker queues, user code) can reclaim their own resources too. The drain's aggregate rides `cache:pressure` below.
  mochiEvents.emit('memory:pressure', { level });
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
  mochiEvents.emit('cache:pressure', result);
  return result;
}

/**
 * Subscribe to the OS low-memory notification. Idempotent, so repeated `Mochi.serve()` calls in one process install one
 * handler. The listener does not keep the event loop alive.
 */
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
