import { SvelteDate } from 'svelte/reactivity';
import { pinGlobal } from '../utils/globalState';
import { isReloadingDeferredIsland, subscribeDeferredIsland } from './deferInvalidation';

// `$state` fields rather than a module-level rune: a field initializer only runs on construction,
// so the npm barrel can load this module uncompiled instead of throwing on import.
export class DeferReloadState {
  reloading = $state(false);
  count = $state(0);
  lastReloadOk = $state<boolean | null>(null);
  lastReloaded = $state<Date | null>(null);

  constructor(name: string) {
    this.reloading = isReloadingDeferredIsland(name);
    subscribeDeferredIsland(name, (change) => {
      // Re-read rather than trust the notifying element: islands can share a name, and this
      // holds while any of them is still going.
      this.reloading = isReloadingDeferredIsland(name);
      if (change.ok !== undefined) {
        this.count++;
        this.lastReloadOk = change.ok;
        this.lastReloaded = new SvelteDate();
      }
    });
  }
}

const instances = () => pinGlobal('__mochi_defer_reload_states__', () => new Map<string, DeferReloadState>());

// Cached per name because each instance subscribes for good, so a per-read instance would leak one.
export function deferReloadState(name: string): DeferReloadState {
  const map = instances();
  let state = map.get(name);
  if (!state) {
    state = new DeferReloadState(name);
    map.set(name, state);
  }
  return state;
}
