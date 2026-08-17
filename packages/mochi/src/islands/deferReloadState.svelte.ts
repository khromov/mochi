import { SvelteDate } from 'svelte/reactivity';
import { pinGlobal } from '../utils/globalState';
import { isReloadingDeferredIsland, subscribeDeferredIsland } from './deferInvalidation';

/**
 * Reactive reload state for one named `mochi:defer` island.
 *
 * The fields are `$state` *fields* rather than a module-level rune on purpose: a field
 * initializer does not run until the class is constructed, so this module can be loaded by
 * uncompiled TS (the npm barrel) without throwing. Constructing it still needs Svelte, so reach
 * it through {@link deferReloadState} from a component rather than from plain server code.
 */
export class DeferReloadState {
  /** `true` while an island with this name has a fetch in flight — its first load as well as a reload. */
  current = $state(false);
  /** Completed reloads, successful or not. Islands sharing a name each count, so a name on two islands counts two per round. */
  count = $state(0);
  /** Outcome of the last completed reload, or `null` before the first one. */
  lastOk = $state<boolean | null>(null);
  /** When the last reload completed, or `null` before the first one. */
  lastAt = $state<Date | null>(null);

  constructor(name: string) {
    this.current = isReloadingDeferredIsland(name);
    // Re-read rather than trusting the notifying element: several islands can share a name, and
    // `current` is true while *any* of them is still going.
    // Never unsubscribed — instances are cached one per name, so this is bounded.
    subscribeDeferredIsland(name, (change) => {
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

/** One shared instance per island name, so repeated reads do not stack up subscriptions. */
export function deferReloadState(name: string): DeferReloadState {
  const map = instances();
  let state = map.get(name);
  if (!state) {
    state = new DeferReloadState(name);
    map.set(name, state);
  }
  return state;
}
