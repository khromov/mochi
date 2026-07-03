// A hydrated island's component is rendered through a generated "context
// wrapper" — a component that sets the `isHydratable()` context and then
// STATICALLY renders the island component. It must be X's parent (so X itself
// reads the context) and render X statically: a dynamic `<Cmp/>` or a
// `{@render children()}` layer emits an extra hydration anchor on the client
// that the SSR output lacks, tripping a Svelte `hydration_mismatch`. The SAME
// wrapper renders on the server (emitted by the preprocessor) and on the client
// (registered under the island name by the client entry), so the markers agree.
//
// The wrapper is a virtual module so it can be materialized on demand during
// each Bun.build, avoiding the chicken-and-egg of the SSR build discovering
// islands while it compiles.

export const WRAPPER_PREFIX = 'mochi-island-wrapper:';

/** Import specifier for the context wrapper around the island at `resolvedPath`. */
export function wrapperSpecifier(resolvedPath: string): string {
  return WRAPPER_PREFIX + resolvedPath;
}

/** True for a specifier produced by {@link wrapperSpecifier}. */
export function isWrapperSpecifier(specifier: string): boolean {
  return specifier.startsWith(WRAPPER_PREFIX);
}

/** The island component's resolved path, recovered from its wrapper specifier. */
export function componentPathFromWrapper(specifier: string): string {
  return specifier.slice(WRAPPER_PREFIX.length);
}

/**
 * Svelte source for the context wrapper. `isHydratableModulePath` is the
 * absolute path to `isHydratable.ts` (resolved by ComponentRegistry, which owns
 * the framework dir).
 */
export function wrapperSource(resolvedComponentPath: string, isHydratableModulePath: string): string {
  return [
    `<script>`,
    `  import Cmp from ${JSON.stringify(resolvedComponentPath)};`,
    `  import { setContext } from 'svelte';`,
    `  import { HYDRATABLE_KEY } from ${JSON.stringify(isHydratableModulePath)};`,
    `  setContext(HYDRATABLE_KEY, true);`,
    `  let props = $props();`,
    `</script>`,
    `<Cmp {...props} />`,
    ``,
  ].join('\n');
}
