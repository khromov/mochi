// Module augmentation that whitelists Mochi's `mochi:*` attribute directives
// on every Svelte HTML element so editor IntelliSense and `svelte-check`
// don't flag them. Pulled in transitively via `mochi-framework/ambient`.

declare module 'svelte/elements' {
  interface MochiHydrateVisibleOptions {
    rootMargin?: string;
  }

  interface MochiDeferOptions {
    retries?: number;
  }

  interface MochiDeferVisibleOptions {
    rootMargin?: string;
    retries?: number;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface HTMLAttributes<T> {
    'mochi:hydrate'?: boolean;
    'mochi:hydrate:visible'?: boolean | MochiHydrateVisibleOptions;
    'mochi:defer'?: boolean | MochiDeferOptions;
    'mochi:defer:visible'?: boolean | MochiDeferVisibleOptions;
    'mochi:clientOnly'?: boolean;
  }
}

export {};
