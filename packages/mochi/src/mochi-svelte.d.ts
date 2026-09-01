// Whitelists the `mochi:*` directives on every Svelte HTML element for editors and
// `svelte-check`; components opt in by intersecting `MochiDirectives` into their props.
import type { MochiDirectives } from './islands/directives';

declare module 'svelte/elements' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface HTMLAttributes<T> extends MochiDirectives {}
}
