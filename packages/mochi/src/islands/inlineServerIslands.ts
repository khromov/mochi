import { requestContext } from '../runtime/requestContext';
import { logger } from '../utils/log';
import { isReloadableIslandName } from './deferInvalidation';

export const DEFAULT_INLINE_BUDGET = 32;

const warned = new Set<string>();

// Once per offending value, not per render — this runs on every defer call site.
function warnOnce(key: string, message: string): void {
  if (!warned.has(key)) {
    warned.add(key);
    logger.warn(message);
  }
}

/**
 * Runtime decision for one nested `mochi:defer` call site: render the child in-process, or emit the fetch placeholder.
 * Reads the ALS instance directly (not `getRequestContext()`) so detached renders (email/static) and non-island requests
 * quietly take the placeholder path instead of throwing.
 */
export function shouldInlineIsland(options?: unknown): boolean {
  if (typeof options === 'object' && options !== null) {
    const opts = options as { inline?: boolean; name?: unknown };
    if (opts.name !== undefined && !isReloadableIslandName(opts.name)) {
      warnOnce(`invalid:${String(opts.name)}`, `[mochi] mochi:defer name must be a non-empty string; ignoring ${JSON.stringify(opts.name)} — the island will not be reloadable.`);
    }
    if (isReloadableIslandName(opts.name)) {
      if (opts.inline === true) {
        warnOnce(
          `inline:${opts.name}`,
          `[mochi] mochi:defer { name: '${opts.name}', inline: true }: a named island needs its own wrapper to reload into, so inline: true is ignored.`,
        );
      }
      // A named island opts out: inlining emits no wrapper for `reloadDeferredIsland` to find.
      return false;
    }
    if (opts.inline === false) {
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
