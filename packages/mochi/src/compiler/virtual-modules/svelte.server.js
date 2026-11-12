export { __MOCHI_SVELTE_EXPORTS__ } from 'svelte';
import { getContext, hydratable as svelteHydratable } from 'svelte';

const RESOLVED = Symbol.for('mochi:hydratable-values');

// Svelte's DEV runtime re-runs `fn` for an already-registered key to detect clobbering, so a fallback that is only
// meant to run when the key is missing (e.g. an island reusing the page's key) would otherwise throw during SSR.
export function hydratable(key, fn) {
  let resolved;
  try {
    resolved = getContext(RESOLVED);
  } catch {
    return svelteHydratable(key, fn);
  }
  if (!resolved) return svelteHydratable(key, fn);
  if (!resolved.has(key)) {
    const value = svelteHydratable(key, fn);
    resolved.set(key, value);
    return value;
  }
  return svelteHydratable(key, () => {
    try {
      return fn();
    } catch {
      return resolved.get(key);
    }
  });
}
