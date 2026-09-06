// Whitelists Mochi's `mochi:*` directives for editors and `svelte-check`: on every HTML element
// through `svelte/elements`, and on every component by widening the props svelte2tsx derives.
import type { Component } from 'svelte';
import type { MochiDirectives } from './islands/directives';

declare module 'svelte/elements' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface HTMLAttributes<T> extends MochiDirectives {}
}

// svelte2tsx emits `Record<string, never>` for a component without `$props()`, where an
// intersection would leave the directive keys typed `never`.
type WithMochiDirectives<Props> = Props extends Record<string, never> ? MochiDirectives : Props & MochiDirectives;

// svelte2tsx types every non-generic component through these helpers, and an overload declared
// here is tried first, so call sites accept the directives without touching the component.
// Generic components get a private interface from svelte2tsx and need `MochiDirectives` explicitly.
declare global {
  function __sveltets_2_fn_component<Props extends Record<string, any>, Exports extends Record<string, any>, Bindings extends string>(klass: {
    props: Props;
    exports?: Exports;
    bindings?: Bindings;
  }): Component<WithMochiDirectives<Props>, Exports, Bindings>;

  function __sveltets_2_isomorphic_component<
    Props extends Record<string, any>,
    Events extends Record<string, any>,
    Slots extends Record<string, any>,
    Exports extends Record<string, any>,
    Bindings extends string,
  >(klass: {
    props: Props;
    events: Events;
    slots: Slots;
    exports?: Exports;
    bindings?: Bindings;
  }): __sveltets_2_IsomorphicComponent<WithMochiDirectives<Props>, Events, Slots, Exports, Bindings>;

  function __sveltets_2_isomorphic_component_slots<
    Props extends Record<string, any>,
    Events extends Record<string, any>,
    Slots extends Record<string, any>,
    Exports extends Record<string, any>,
    Bindings extends string,
  >(klass: {
    props: Props;
    events: Events;
    slots: Slots;
    exports?: Exports;
    bindings?: Bindings;
  }): __sveltets_2_IsomorphicComponent<WithMochiDirectives<__sveltets_2_PropsWithChildren<Props, Slots>>, Events, Slots, Exports, Bindings>;
}
