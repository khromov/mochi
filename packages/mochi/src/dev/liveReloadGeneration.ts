// A reconnecting tab needs to know whether anything happened while it was
// gone. The boot id catches a dev-server restart, but the watcher also
// broadcasts `reload` without restarting the process (a `.svelte` edit), and a
// tab that was disconnected right then would never hear about it. So every
// reload signal also bumps a counter, scoped the same way the signal itself is
// scoped, and the greeting carries the count for the reconnecting tab's entry.

const BOOT_ID = crypto.randomUUID();

// Reloads that went to every tab (unscoped rebuild failures) — they count
// toward every entry's generation.
let unscopedReloads = 0;
// Reloads scoped to a specific set of entries, counted per entry.
const scopedReloads = new Map<string, number>();
let totalReloads = 0;

/**
 * Record a reload broadcast. `affected` mirrors the watcher's scoping: when
 * omitted the signal went to every tab.
 */
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

/**
 * The greeting sent on connect: `boot:<process id>:<reload generation>`. A
 * reconnecting tab reloads when either half moved.
 */
export function liveReloadGreeting(entry: string | undefined): string {
  // A tab that reports no entry is signalled on every change (see
  // `notifyClients`), so its generation is the unfiltered total.
  const generation = entry === undefined ? totalReloads : unscopedReloads + (scopedReloads.get(entry) ?? 0);
  return `boot:${BOOT_ID}:${generation}`;
}
