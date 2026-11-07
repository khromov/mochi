import { pinGlobal } from '../utils/globalState';

// `ServerIsland.ts` is inline-bundled separately from `HydratableIsland.ts`
// (see `buildInlineWebComponent`), so a plain module-level `Set` would be
// duplicated per-bundle and the same stylesheet could be injected twice.
// `pinGlobal` keys it once per process so both bundles share the tracker.
const pool = pinGlobal<Set<string>>('__mochi_loaded_css__', () => new Set<string>());

export function isLoadedCss(url: string): boolean {
  return pool.has(url);
}

export function markLoadedCss(url: string): void {
  pool.add(url);
}
