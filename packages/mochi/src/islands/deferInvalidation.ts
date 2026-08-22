import mitt from 'mitt';
import { pinGlobal } from '../utils/globalState';
import type {} from '../debug-bar/types';

// Structural, so this module never imports the web-component class it describes.
export interface ReloadableIsland {
  reload(): Promise<boolean>;
  isReloading(): boolean;
}

// On globalThis because the inline island script and the hydration bundle are separate bundles
// that share state only here — the same pattern as `__mochi_loaded_css__`.
const registry = () => pinGlobal('__mochi_deferred_islands__', () => new Map<string, Set<ReloadableIsland>>());

// Shared by the render-time inlining decision and the wrapper element, so "named" means one thing everywhere.
export function isReloadableIslandName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0;
}

export function registerDeferredIsland(name: string, island: ReloadableIsland): void {
  const map = registry();
  let set = map.get(name);
  if (!set) {
    set = new Set();
    map.set(name, set);
  }
  set.add(island);
}

// `ok` is present only once a reload round has finished, which is how a listener tells the edges apart.
export interface DeferredIslandChange {
  ok?: boolean;
}

type ChangeListener = (change: DeferredIslandChange) => void;
// mitt, the same pattern as `__mochi_events__`: its emit snapshots the handler list and its off()
// is a no-op on a double-unsubscribe, both of which this pub/sub needs.
const listeners = () => pinGlobal('__mochi_deferred_island_listeners__', () => mitt<Record<string, DeferredIslandChange>>());

export function subscribeDeferredIsland(name: string, listener: ChangeListener): () => void {
  listeners().on(name, listener);
  return () => listeners().off(name, listener);
}

export function notifyDeferredIslandChange(name: string, change: DeferredIslandChange = {}): void {
  listeners().emit(name, change);
}

export function unregisterDeferredIsland(name: string, island: ReloadableIsland): void {
  const map = registry();
  const set = map.get(name);
  if (!set) {
    return;
  }
  set.delete(island);
  if (set.size === 0) {
    map.delete(name);
  }
}

export function reloadDeferredIsland(name: string): Promise<void> {
  const set = registry().get(name);
  if (!set || set.size === 0) {
    // Browser-only: the registry is empty by construction during SSR, so this would warn on
    // every render of isomorphic island code.
    if (typeof window !== 'undefined') {
      window.__mochi_warn?.(`[mochi] reloadDeferredIsland("${name}"): no deferred island with that name is mounted.`);
    }
    return Promise.resolve();
  }
  // One outcome per round: with islands sharing the name, a partial failure must not be masked
  // by whichever element happens to settle last.
  return Promise.all([...set].map((island) => island.reload())).then((oks) => {
    notifyDeferredIslandChange(name, { ok: oks.every(Boolean) });
  });
}

// Internal: the source `DeferReloadState.reloading` is derived from.
export function isReloadingDeferredIsland(name: string): boolean {
  const set = registry().get(name);
  return set ? [...set].some((island) => island.isReloading()) : false;
}

export function reloadDeferredIslandAll(): Promise<void> {
  return Promise.all([...registry().keys()].map((name) => reloadDeferredIsland(name))).then(() => {});
}
