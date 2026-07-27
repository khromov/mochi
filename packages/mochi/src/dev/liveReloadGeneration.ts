// A reconnecting tab needs to know whether anything happened while it was gone. The boot id catches a dev-server
// restart, but the watcher also broadcasts `reload` without restarting the process on a `.svelte` edit, which a
// disconnected tab would miss — so every reload bumps a counter, scoped like the signal itself, and the greeting
// carries the count for the reconnecting tab's entry.

const BOOT_ID = crypto.randomUUID();

// Reloads that went to every tab (unscoped rebuild failures) — they count
// toward every entry's generation.
let unscopedReloads = 0;
// Reloads scoped to a specific set of entries, counted per entry.
const scopedReloads = new Map<string, number>();
let totalReloads = 0;

/** Record a reload broadcast. `affected` mirrors the watcher's scoping; omitting it means the signal went to every tab. */
export function recordReloadSignal(affected?: Set<string>): void {
  totalReloads++;
  if (affected === undefined) {
    unscopedReloads++;
    return;
  }
  for (const entry of affected) {
    scopedReloads.set(entry, (scopedReloads.get(entry) ?? 0) + 1);
  }
}

/** The greeting sent on connect, `boot:<process id>:<reload generation>`; a reconnecting tab reloads when either half moved. */
export function liveReloadGreeting(entry: string | undefined): string {
  // A tab that reports no entry is signalled on every change (see
  // `notifyClients`), so its generation is the unfiltered total.
  const generation = entry === undefined ? totalReloads : unscopedReloads + (scopedReloads.get(entry) ?? 0);
  return `boot:${BOOT_ID}:${generation}`;
}
