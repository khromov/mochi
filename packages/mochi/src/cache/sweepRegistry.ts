import { pinGlobal } from '../utils/globalState';

/** The framework's own cache janitor task. Reserved name — an app cannot declare it. */
export const CACHE_SWEEP_TASK = 'mochi:cache-sweep';

/** A storage that wants the shared janitor to drive its eviction pass. */
export interface SweepableStorage {
  sweepAndReport(): void | Promise<void>;
}

// Pinned like __mochi_image_runtime__: compiled Svelte components get their own
// bundled copy of this module, and a storage constructed inside one must still be
// visible to the janitor task registered from the main bundle.
const sweepables = pinGlobal<Set<SweepableStorage>>('__mochi_cache_sweepables__', () => new Set());

/** Throws rather than ignores: a storage sweeping on a schedule the caller didn't ask for shows up as unbounded disk growth weeks later. */
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

// Takes any object, so a caller-supplied `Storage` handed to a subsystem with its
// own sweep schedule can be removed without proving it implemented the interface.
export function unregisterSweepable(storage: object): void {
  sweepables.delete(storage as SweepableStorage);
}

export function sweepableCount(): number {
  return sweepables.size;
}

/**
 * Each storage is swept in its own try/catch so one bad backend can't cost the others their pass, but
 * failures are re-thrown together so the task runner reports them instead of the janitor degrading into a silent no-op.
 */
export async function sweepAllRegistered(): Promise<void> {
  const failures: Error[] = [];
  // Snapshot so the set can be mutated mid-pass, then re-check membership: a
  // storage disposed during this pass has closed whatever its sweep would reach for.
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
