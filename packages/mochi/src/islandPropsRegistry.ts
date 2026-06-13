import { stringify } from 'devalue';
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
 * Server islands intentionally do NOT use this path. Their `signed-props`
 * payloads are HMAC-signed and travel through URL query strings, so they keep
 * using `stringify` directly via the preprocessor's server-island branch.
 */
export function emitIslandProps(value: unknown): string {
  const json = stringify(value);
  const ctx = getRequestContext();
  let id = ctx.islandProps.get(json);
  if (!id) {
    id = `mochi-props-${ctx.islandProps.size}`;
    ctx.islandProps.set(json, id);
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
