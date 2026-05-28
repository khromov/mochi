import { stringify } from 'devalue';
import { logger } from './log';
import { getRequestContext } from './requestContext';

/**
 * Serialize a hydratable island's props via devalue and register them in the
 * per-request dedup registry. Returns a stable ref id (e.g. "mochi-props-3")
 * that the preprocessor emits as the `props-ref` attribute. After SSR,
 * `ComponentRegistry` hoists the registry into shared
 * `<script type="application/json" id="mochi-props-N">` blocks.
 *
 * Two islands whose serialized JSON is byte-identical share the same ref id;
 * that's the entire dedup mechanism — no post-render HTML scan required.
 *
 * If `islandId` is supplied and `ctx.debugBarData` is initialized (dev mode),
 * the pretty-printed JSON is also recorded under `debugBarData.islandProps`
 * keyed by islandId so the dev toolbar can render it without a post-render
 * HTML scan.
 *
 * Server islands intentionally do NOT use this path. Their `signed-props`
 * payloads are AES-256-GCM encrypted and travel through URL query strings, so
 * they keep using `stringify` directly via the preprocessor's server-island branch.
 */
export function emitIslandProps(value: unknown, islandId?: string): string {
  const json = stringify(value);
  const ctx = getRequestContext();
  let id = ctx.islandProps.get(json);
  if (!id) {
    id = `mochi-props-${ctx.islandProps.size}`;
    ctx.islandProps.set(json, id);
  }
  if (islandId && ctx.debugBarData) {
    let pretty = json;
    try {
      pretty = JSON.stringify(JSON.parse(json), null, 2);
    } catch (err) {
      if (err instanceof SyntaxError) {
        const m = err.message.match(/position (\d+)/);
        const pos = m ? Number(m[1]) : -1;
        if (pos >= 0) {
          const ch = json.charCodeAt(pos);
          const around = json.slice(Math.max(0, pos - 20), pos + 20);
          logger.warn(`Island "${islandId}" props unparseable at position ${pos} (char U+${ch.toString(16).padStart(4, '0')}, len=${json.length}): ${JSON.stringify(around)}`);
        } else {
          logger.warn(`Island "${islandId}" props unparseable: ${err.message}`);
        }
      } else {
        logger.warn(`Island "${islandId}" props pretty-print failed: ${err}`);
      }
    }
    ctx.debugBarData.islandProps[islandId] = pretty;
  }
  return id;
}

/**
 * Build the `<script type="application/json">` blocks that carry the
 * deduplicated props for a single rendered page. Caller is responsible for
 * prepending the result to the rendered body. Every `<` inside the JSON is
 * escaped to its `<` JSON unicode escape so the HTML script-data
 * tokenizer (which ignores `type="application/json"`) cannot see a `</script`
 * sequence and terminate the block early.
 */
export function buildIslandPropsScripts(registry: Map<string, string>): string {
  if (registry.size === 0) {
    return '';
  }
  let out = '';
  for (const [json, id] of registry) {
    const safe = json.replace(/</g, '\\u003C');
    out += `<script type="application/json" id="${id}">${safe}</script>`;
  }
  return out;
}
