/**
 * Runtime backstop for server-process-only framework internals — the extension registry, the `Mochi.serve()` config
 * singleton, the request context. `compiler/serverOnlyModuleGuard.ts` already fails the client build when one resolves
 * into a browser graph; this catches anything reaching a browser another way, like a hand-rolled bundle. Without it
 * these APIs degrade silently: an empty filter registry hands back the framework default and a configured filter
 * quietly stops applying.
 */

// `declare` erases before bundling, so `MOCHI_CLIENT` reaches Bun as a free identifier its `define` folds to `true`,
// dead-code-eliminating each guard below down to a bare throw. Elsewhere the identifier is genuinely undeclared, which
// `typeof` handles safely.
declare const MOCHI_CLIENT: boolean | undefined;

export const IS_CLIENT_BUNDLE = typeof MOCHI_CLIENT !== 'undefined' && MOCHI_CLIENT === true;

export function assertServerOnly(api: string, why: string): void {
  if (IS_CLIENT_BUNDLE) {
    throw new Error(`[mochi] ${api} was called in the browser. ${why}`);
  }
}
