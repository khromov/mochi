// Stands in for a user's `.server.ts`: reached from the app entry's routes, never from a `.svelte`, so Bun imports it
// directly and no `Bun.build` rewrites `mochi-framework` to the `mochi-env` virtual module.
import { isBrowser, isDev, isServer } from 'mochi-framework';

/** Captured at module load — before `Mochi.serve()` runs, which is the case the env seed exists for. */
export const atModuleLoad = { isDev, isServer, isBrowser };

export function readNow(): { isDev: boolean; isServer: boolean; isBrowser: boolean } {
  return { isDev, isServer, isBrowser };
}
