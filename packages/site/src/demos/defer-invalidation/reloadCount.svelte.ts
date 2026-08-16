// Svelte universal reactivity: a rune-backed store shared across islands. Any
// hydrated component that reads `reloads.count` re-renders when a reload lands.
export const reloads = $state({ count: 0 });
