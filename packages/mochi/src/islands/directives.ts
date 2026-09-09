export interface MochiHydrateVisibleOptions {
  rootMargin?: string;
}

export interface MochiDeferOptions {
  retries?: number;
  name?: string;
  inline?: boolean;
}

export interface MochiDeferVisibleOptions {
  rootMargin?: string;
  retries?: number;
  name?: string;
}

export interface MochiClientOnlyVisibleOptions {
  rootMargin?: string;
}

/**
 * The `mochi:*` call-site directives. Intersect into an island's `$props()` type so
 * `<Island mochi:defer />` type-checks: Mochi strips the directives before Svelte compiles,
 * but svelte2tsx checks them against the component's props. A type alias rather than an
 * interface so props stay assignable to `Record<string, unknown>`.
 */
export type MochiDirectives = {
  'mochi:hydrate'?: boolean;
  'mochi:hydrate:visible'?: boolean | MochiHydrateVisibleOptions;
  'mochi:defer'?: boolean | MochiDeferOptions;
  'mochi:defer:visible'?: boolean | MochiDeferVisibleOptions;
  'mochi:clientOnly'?: boolean;
  'mochi:clientOnly:visible'?: boolean | MochiClientOnlyVisibleOptions;
};
