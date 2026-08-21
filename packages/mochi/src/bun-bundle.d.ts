// Restricts `feature()` (from `bun:bundle`) to the framework's known client-build flags, so a
// typo like `feature('MOCH_DEBUG')` is a compile error. `@types/bun` already declares the module
// and `feature` itself — this only augments its `Registry`.
//
// - MOCHI_DEBUG: verbose island debug logging; on in dev, stripped from prod client bundles.
// - MOCHI_CLIENT: browser-build platform flag; strips server-only ANSI from the isomorphic logger.
declare module 'bun:bundle' {
  interface Registry {
    features: 'MOCHI_DEBUG' | 'MOCHI_CLIENT';
  }
}
