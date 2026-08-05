import { requestContext } from '../runtime/requestContext';

export const DEFAULT_INLINE_BUDGET = 32;

/**
 * Runtime decision for one nested `mochi:defer` call site: render the child in-process, or emit the fetch placeholder.
 * Reads the ALS instance directly (not `getRequestContext()`) so detached renders (email/static) and non-island requests
 * quietly take the placeholder path instead of throwing.
 */
export function shouldInlineIsland(options?: unknown): boolean {
  if (typeof options === 'object' && options !== null && (options as { inline?: boolean }).inline === false) {
    return false;
  }
  const st = requestContext.getStore()?.islandInline;
  if (!st || st.budget <= 0) {
    return false;
  }
  st.budget--;
  return true;
}
