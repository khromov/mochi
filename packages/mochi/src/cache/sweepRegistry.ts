import { pinGlobal } from '../utils/globalState';

/** The framework's own cache janitor task. Reserved name — an app cannot declare it. */
export const CACHE_SWEEP_TASK = 'mochi:cache-sweep';

/** A storage that wants the shared janitor to drive its eviction pass. */
export interface SweepableStorage {
  /** One eviction pass, reporting through whatever channel the backend already uses. */
  sweepAndReport(): void | Promise<void>;
}

// Pinned like __mochi_image_runtime__: compiled Svelte components get their own
// bundled copy of this module, and a storage constructed inside one must still be
// visible to the janitor task registered from the main bundle.
const sweepables = pinGlobal<Set<SweepableStorage>>('__mochi_cache_sweepables__', () => new Set());

/**
 * Throw on the interval option the janitor task replaced, rather than ignoring it.
 * A storage silently sweeping on a schedule the caller didn't ask for shows up as
 * unbounded disk growth weeks later — the same reason `sweepIntervalMs` throws.
 */
export function assertNoPurgeInterval(options: object, storageName: string): void {
  if ((options as { purgeInterval?: unknown }).purgeInterval !== undefined) {
    throw new Error(
      `${storageName}: \`purgeInterval\` was replaced by \`purge\`, a boolean — the \`${CACHE_SWEEP_TASK}\` task owns the schedule now, set with Mochi.serve({ cache: { sweepCron } }). Use purge: false for the old purgeInterval: 0, and drop the option otherwise.`,
    );
  }
}

export function registerSweepable(storage: SweepableStorage): void {
  sweepables.add(storage);
}

// Takes any object: a caller-supplied `Storage` handed to a subsystem that owns
// its own sweep schedule needs taking off this list without proving it ever
// implemented the interface.
export function unregisterSweepable(storage: object): void {
  sweepables.delete(storage as SweepableStorage);
}

/** How many storages the janitor would sweep right now. */
export function sweepableCount(): number {
  return sweepables.size;
}

/**
 * One janitor pass across every registered storage.
 *
 * Each storage is swept in its own try/catch so one bad backend can't cost the
 * others their pass, but the failures are re-thrown together at the end — the
 * task runner logs them and emits `task:error`, which is how a broken janitor
 * stays visible instead of degrading into a silent no-op.
 */
export async function sweepAllRegistered(): Promise<void> {
  const failures: Error[] = [];
  // Snapshot so the set can be mutated while a sweep awaits, then re-check
  // membership per entry: a storage that disposed during this pass has already
  // closed whatever its sweep would reach for.
  for (const storage of [...sweepables]) {
    if (!sweepables.has(storage)) {
      continue;
    }
    try {
      await storage.sweepAndReport();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, `${failures.length} cache storages failed to sweep`);
  }
}
