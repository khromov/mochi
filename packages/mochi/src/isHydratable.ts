import { getContext } from 'svelte';

// Shared across every bundled copy (client runtime, SSR build, framework
// components) — a file-local `Symbol()` would mint a distinct key per bundle
// and never match. `Symbol.for` interns by string, so the setter (the island
// boundary) and this getter always agree.
export const HYDRATABLE_KEY: symbol = Symbol.for('mochi:hydratable');

/**
 * `true` when the calling component is anywhere inside a hydrated island
 * subtree — during both the SSR pass and the client hydration pass — and
 * `false` for plain SSR-only components. Unlike the value's ancestor-only
 * prop predecessor, this reads a Svelte context seeded once at the island
 * boundary, so it propagates to descendants at any depth.
 *
 * Reads context, so call it during component init (top of `<script>`), like
 * Svelte's own `getContext` / `hydratable`.
 */
export function isHydratable(): boolean {
  return getContext(HYDRATABLE_KEY) === true;
}
