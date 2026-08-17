import { createSubscriber } from 'svelte/reactivity';
import { isReloadingDeferredIsland, subscribeDeferredIsland } from './deferInvalidation';

export interface DeferredIslandReloading {
  readonly current: boolean;
}

// The reactive counterpart to `isReloadingDeferredIsland`. Kept in its own module so the
// `svelte/reactivity` import stays out of the inline `<mochi-server-island>` script, which is
// bundled separately and is not Svelte-compiled.
//
// Reading `.current` inside a component subscribes it to that island's reload start/end; read
// anywhere else it is just the current value, so it works as a plain check too. `createSubscriber`
// is a no-op on the server, where no island is ever mounted.
export function reloadingDeferredIsland(name: string): DeferredIslandReloading {
  const subscribe = createSubscriber((update) => subscribeDeferredIsland(name, update));
  return {
    get current() {
      subscribe();
      return isReloadingDeferredIsland(name);
    },
  };
}
