import { requestContext } from '../runtime/requestContext';

export const DEFAULT_INLINE_BUDGET = 32;

/**
 * Runtime decision for one nested `mochi:defer` call site: render the child in-process, or emit the fetch placeholder.
 * Reads the ALS instance directly (not `getRequestContext()`) so detached renders (email/static) and non-island requests
 * quietly take the placeholder path instead of throwing.
 */
export function shouldInlineIsland(options?: unknown): boolean {
  if (typeof options === 'object' && options !== null) {
    const opts = options as { inline?: boolean; name?: unknown };
    // A named island opts out: inlining emits no wrapper for `reloadDeferredIsland` to find.
    if (opts.inline === false || typeof opts.name === 'string') {
      return false;
    }
  }
  const st = requestContext.getStore()?.islandInline;
  // `!(> 0)` so a NaN budget from a misbehaving `serverIsland:inlineBudget` filter fails closed to the placeholder path.
  if (!st || !(st.budget > 0)) {
    return false;
  }
  // A throwing child's unit stays spent — by the time its boundary fails, the child's own nested spends can't be unwound.
  st.budget--;
  return true;
}
