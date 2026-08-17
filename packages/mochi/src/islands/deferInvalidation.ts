import { pinGlobal } from '../utils/globalState';
import type {} from '../debug-bar/types';

// Structural, so this module never imports the web-component class it describes.
export interface ReloadableIsland {
  reload(): Promise<void>;
  isReloading(): boolean;
}

// On globalThis because the inline island script and the hydration bundle are separate bundles
// that share state only here — the same pattern as `__mochi_loaded_css__`.
const registry = () => pinGlobal('__mochi_deferred_islands__', () => new Map<string, Set<ReloadableIsland>>());

export function registerDeferredIsland(name: string, island: ReloadableIsland): void {
  const map = registry();
  let set = map.get(name);
  if (!set) {
    set = new Set();
    map.set(name, set);
  }
  set.add(island);
}

// `ok` is present only once a reload has finished, which is how a listener tells the edges apart.
export interface DeferredIslandChange {
  ok?: boolean;
}

type ChangeListener = (change: DeferredIslandChange) => void;
const listeners = () => pinGlobal('__mochi_deferred_island_listeners__', () => new Map<string, Set<ChangeListener>>());

export function subscribeDeferredIsland(name: string, listener: ChangeListener): () => void {
  const map = listeners();
  let set = map.get(name);
  if (!set) {
    set = new Set();
    map.set(name, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      map.delete(name);
    }
  };
}

export function notifyDeferredIslandChange(name: string, change: DeferredIslandChange = {}): void {
  const set = listeners().get(name);
  if (!set) {
    return;
  }
  // Snapshotted: a listener may unsubscribe itself while being notified.
  for (const listener of [...set]) {
    listener(change);
  }
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
  return Promise.all([...set].map((island) => island.reload())).then(() => {});
}

// Internal: the source `DeferReloadState.reloading` is derived from.
export function isReloadingDeferredIsland(name: string): boolean {
  const set = registry().get(name);
  return set ? [...set].some((island) => island.isReloading()) : false;
}

export function reloadDeferredIslandAll(): Promise<void> {
  const reloads: Promise<void>[] = [];
  for (const set of [...registry().values()]) {
    for (const island of [...set]) {
      reloads.push(island.reload());
    }
  }
  return Promise.all(reloads).then(() => {});
}
