/**
 * Runtime backstop for framework internals that only work in the server
 * process — the extension registry, the `Mochi.serve()` config singleton, the
 * request context. `compiler/serverOnlyModuleGuard.ts` already fails the client
 * build when one of those modules is resolved into a browser graph; this catches
 * anything that reaches a browser by some other route (a hand-rolled bundle, a
 * future build path that forgets the plugin).
 *
 * Without it these APIs *silently* degrade: an empty filter registry hands back
 * the framework default, so a configured filter just quietly stops applying.
 */

// `declare` erases before bundling, so `MOCHI_CLIENT` reaches Bun as a free
// identifier its `define` folds to `true` — and the whole constant then
// dead-code-eliminates each guard below down to a bare throw. Everywhere else
// the identifier is genuinely undeclared, which `typeof` handles safely.
declare const MOCHI_CLIENT: boolean | undefined;

export const IS_CLIENT_BUNDLE = typeof MOCHI_CLIENT !== 'undefined' && MOCHI_CLIENT === true;

export function assertServerOnly(api: string, why: string): void {
  if (IS_CLIENT_BUNDLE) {
    throw new Error(`[mochi] ${api} was called in the browser. ${why}`);
  }
}
