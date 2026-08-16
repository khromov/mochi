// A `.svelte.ts` module, so `$state` works outside a component.
export const reloads = $state({ count: 0 });
