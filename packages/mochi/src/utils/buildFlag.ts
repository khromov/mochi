// A live-binding flag so `import { isBuilding }` reflects the value at access
// time. `markBuilding()` is called by the build CLI before it imports the app
// entry, letting server-setup code skip real-boot side effects during a
// `mochi-framework build`.
import { AsyncLocalStorage } from 'node:async_hooks';
import { pinGlobal } from './globalState';

export let isBuilding = false;

export function markBuilding(): void {
  isBuilding = true;
}

// The dev watcher re-imports the entry inside the *running* server to hot-swap routes, so that import's side effects
// must be suppressed without the process-wide flag — a sticky flag there would silently disable every queue add for the
// rest of the dev session. Async-scoped rather than a toggle so a request adding a job mid-rebuild is unaffected.
// Pinned for the same reason as the request context: duplicate bundled copies must share one instance.
const entryImportScope = pinGlobal('__mochi_entry_import_scope__', () => new AsyncLocalStorage<true>());

export function runInEntryImportScope<T>(fn: () => Promise<T>): Promise<T> {
  return entryImportScope.run(true, fn);
}

/** True while a `mochi-framework build` runs, or while the app entry is being re-imported to extract its serve options. */
export function isBuildingEntry(): boolean {
  return isBuilding || entryImportScope.getStore() === true;
}
