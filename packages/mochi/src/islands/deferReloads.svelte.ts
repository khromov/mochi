import { isReloadingDeferredIsland, subscribeDeferredIslandAny } from './deferInvalidation';

/**
 * Shared reactive state: `true` while the island of that name is reloading.
 *
 * ```svelte
 * import { deferReloads } from 'mochi-framework';
 * {#if deferReloads.cart}<Spinner />{/if}
 * ```
 *
 * Universal reactivity — a rune in a `.svelte.ts` module, so importers all read the one proxy
 * and a component that reads a key re-renders when it changes. Only ever mutated, never
 * reassigned: importers bind to the object, so replacing it would leave them on the old one.
 *
 * A `<mochi-server-island>` cannot write here directly. It ships in the inline page script,
 * which is not Svelte-compiled, so it reports through the plain registry and this module
 * mirrors that into the rune.
 */
export const deferReloads: Record<string, boolean> = $state({});

subscribeDeferredIslandAny((name) => {
  deferReloads[name] = isReloadingDeferredIsland(name);
});
