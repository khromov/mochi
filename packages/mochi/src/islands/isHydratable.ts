import { getContext } from 'svelte';

/**
 * Interned via `Symbol.for` so every bundled copy of the framework (SSR
 * chunks, client bundles, direct `index.ts` imports, and the preprocessor's
 * inline seed) resolves the same context slot.
 */
export const HYDRATABLE_CONTEXT_KEY: symbol = Symbol.for('mochi:hydratable');

/**
 * True when the calling component renders inside a subtree that will hydrate
 * on this page load (a `mochi:hydrate*` island, a `mochi:clientOnly` mount, or
 * a `mochi:defer mochi:hydrate` server island), at any nesting depth. Must be
 * called during component initialization, like `getContext`.
 */
export function isHydratable(): boolean {
  return getContext(HYDRATABLE_CONTEXT_KEY) === true;
}
