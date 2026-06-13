import { stringify } from 'devalue';
import { getRequestContext } from './requestContext';

/**
 * One entry in the per-request island props dedup registry
 * (`ctx.islandProps`): the ref id assigned to a unique serialized payload and
 * the number of islands that emitted that exact payload.
 */
export interface IslandPropsEntry {
  id: string;
  count: number;
}

/**
 * Serialize a hydratable island's props via devalue and register them in the
 * per-request dedup registry. Returns a stable ref id (e.g. "mochi-props-3")
 * that the preprocessor emits as the `props-ref` attribute. After SSR,
 * `injectIslandPropsScripts` emits each payload as a
 * `<script type="application/json" id="mochi-props-N">` block placed just
 * before the first island that references it.
 *
 * Two islands whose serialized JSON is byte-identical share the same ref id;
 * that's the entire dedup mechanism. The per-id use count lets the post-render
 * pass flag blocks that more than one island actually shares.
 *
 * Server islands intentionally do NOT use this path. Their `signed-props`
 * payloads are HMAC-signed and travel through URL query strings, so they keep
 * using `stringify` directly via the preprocessor's server-island branch.
 */
export function emitIslandProps(value: unknown): string {
  const json = stringify(value);
  const ctx = getRequestContext();
  let entry = ctx.islandProps.get(json);
  if (!entry) {
    entry = { id: `mochi-props-${ctx.islandProps.size}`, count: 0 };
    ctx.islandProps.set(json, entry);
  }
  entry.count++;
  return entry.id;
}

/**
 * Emit each registered props payload as a `<script type="application/json"
 * id="mochi-props-N">` block placed immediately before the first
 * `<mochi-hydratable-island>` that references it. Islands sharing a payload
 * (byte-identical serialized JSON) collapse to a single ref id, so only the
 * first one gets a block; the rest read it by id at hydration time. Blocks
 * reused by two or more islands carry a `data-shared` marker so the dev
 * toolbar can flag genuinely deduplicated props without re-counting refs
 * across the DOM — a lone island's block stays unmarked.
 *
 * The match is anchored to the `<mochi-hydratable-island` start tag because
 * Svelte does not escape `"` in text nodes — page prose could otherwise
 * contain a literal `props-ref="mochi-props-0"` — while a raw `<` can never
 * appear in Svelte-escaped text. `[^>]*?` is safe because the preprocessor
 * emits `props-ref` before `hydrate-options`, the only island attribute whose
 * value can contain `>`.
 *
 * Every `<` inside the JSON is escaped to its `<` JSON unicode escape so
 * the HTML script-data tokenizer (which ignores `type="application/json"`)
 * cannot see a `</script` sequence and terminate the block early.
 */
export function injectIslandPropsScripts(html: string, registry: Map<string, IslandPropsEntry>): string {
  if (registry.size === 0) {
    return html;
  }
  const byId = new Map<string, IslandPropsEntry & { json: string }>();
  for (const [json, entry] of registry) {
    byId.set(entry.id, { ...entry, json });
  }
  const emitted = new Set<string>();
  return html.replace(/<mochi-hydratable-island\b[^>]*? props-ref="(mochi-props-\d+)"/g, (m, id: string) => {
    if (emitted.has(id)) {
      return m;
    }
    const entry = byId.get(id);
    if (entry === undefined) {
      return m;
    }
    emitted.add(id);
    const safe = entry.json.replace(/</g, '\\u003C');
    const shared = entry.count >= 2 ? ' data-shared' : '';
    return `<script type="application/json" id="${id}"${shared}>${safe}</script>${m}`;
  });
}
