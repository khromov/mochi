import { SvelteDate } from 'svelte/reactivity';
import { pinGlobal } from '../utils/globalState';
import { isReloadingDeferredIsland, subscribeDeferredIsland } from './deferInvalidation';

// `$state` fields rather than a module-level rune: a field initializer only runs on construction,
// so the npm barrel can load this module uncompiled instead of throwing on import.
export class DeferReloadState {
  current = $state(false);
  count = $state(0);
  lastOk = $state<boolean | null>(null);
  lastAt = $state<Date | null>(null);

  constructor(name: string) {
    this.current = isReloadingDeferredIsland(name);
    subscribeDeferredIsland(name, (change) => {
      // Re-read rather than trust the notifying element: islands can share a name, and `current`
      // holds while any of them is still going.
      this.current = isReloadingDeferredIsland(name);
      if (change.ok !== undefined) {
        this.count++;
        this.lastOk = change.ok;
        this.lastAt = new SvelteDate();
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
