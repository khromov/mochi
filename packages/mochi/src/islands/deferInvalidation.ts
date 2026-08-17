import { pinGlobal } from '../utils/globalState';
import type {} from '../debug-bar/types';

// A `mochi:defer` server-island element, keyed by its `name` option, that can
// re-fetch its server-rendered HTML on demand. Kept structural so this module
// never imports the web-component class (which lives in a separate bundle).
export interface ReloadableIsland {
  reload(): Promise<void>;
  isReloading(): boolean;
}

// The name→instances registry lives on `globalThis` because the inline
// `<mochi-server-island>` script and the hydration bundle (where the public
// `reload*` functions run) are separate bundles that share state only here —
// the same cross-bundle pattern as `__mochi_loaded_css__`.
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

// `ok` is present only on the notification for a reload that just finished, so a listener can
// tell "started" from "finished, and here is how it went" without inspecting the DOM.
export interface DeferredIslandChange {
  ok?: boolean;
}

// Reload start/end listeners, pinned alongside the registry for the same cross-bundle reason:
// `<mochi-server-island>` fires them from the inline script, while the reactive accessor that
// consumes them lives in the hydration bundle.
type ChangeListener = (change: DeferredIslandChange) => void;
const listeners = () => pinGlobal('__mochi_deferred_island_listeners__', () => new Map<string, Set<ChangeListener>>());

// Returns an unsubscribe function.
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

// Re-fetch every `mochi:defer={{ name }}` island tagged with `name` and resolve
// once they have all swapped in. Resolves immediately (with a dev warning) when
// no island carries that name — including during SSR, where the registry is
// empty, so calling this in isomorphic island code is a safe no-op on the server.
export function reloadDeferredIsland(name: string): Promise<void> {
  const set = registry().get(name);
  if (!set || set.size === 0) {
    // Browser-only: on the server the registry is empty by construction, so warning there
    // would fire on every SSR render of isomorphic island code that calls this.
    if (typeof window !== 'undefined') {
      window.__mochi_warn?.(`[mochi] reloadDeferredIsland("${name}"): no deferred island with that name is mounted.`);
    }
    return Promise.resolve();
  }
  return Promise.all([...set].map((island) => island.reload())).then(() => {});
}

// Synchronous, so it can guard a click handler before starting work. True while any island
// with this name has a fetch in flight — its first load as well as a reload, since either way
// fresh HTML is already on its way and a second request would just queue behind it.
// Not reactive: reading it in markup samples it once. Drive UI from the reload promise instead.
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
