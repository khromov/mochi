import { stringify } from 'devalue';
import { getRequestContext } from '../runtime/requestContext';

/** One entry in the per-render dedup registry (`ctx.islandProps`): a unique serialized payload's ref id and how many islands emitted it. */
export interface IslandPropsEntry {
  id: string;
  emitCount: number;
}

/**
 * Serialize a hydratable island's props via devalue and register them in the per-render dedup registry, returning the
 * stable ref id the preprocessor emits as `props-ref`. After SSR, `ComponentRegistry`'s HTMLRewriter pass writes each
 * payload as a `<script type="application/json" id="mochi-props-N">` block just before the first island referencing it.
 *
 * Two islands with byte-identical serialized JSON share one ref id — the whole dedup mechanism — and the per-id emit
 * count lets the render pass flag genuinely shared blocks. Server islands take the preprocessor's own branch instead,
 * since their `signed-props` payloads are encrypted and travel through URL query strings.
 */
export function emitIslandProps(value: unknown): string {
  const json = stringify(value);
  const ctx = getRequestContext();
  let entry = ctx.islandProps.get(json);
  if (!entry) {
    entry = { id: `mochi-props-${ctx.islandProps.size}`, emitCount: 0 };
    ctx.islandProps.set(json, entry);
  }
  entry.emitCount++;
  return entry.id;
}

/**
 * Render the `<script type="application/json" id="mochi-props-N">` block carrying one island's deduplicated props.
 * `ComponentRegistry`'s HTMLRewriter pass calls this once per unique payload, inserting the result immediately before
 * the first `<mochi-hydratable-island>` referencing it, and marks blocks reused by two or more islands `data-shared` so
 * the dev toolbar can flag real deduplication without re-counting refs across the DOM.
 *
 * Every `<` inside the JSON is escaped to `<`, so the HTML script-data tokenizer — which ignores
 * `type="application/json"` — cannot see a `</script` sequence and terminate the block early.
 */
export function renderIslandPropsScript(id: string, json: string, emitCount: number): string {
  const safe = json.replace(/</g, '\\u003C');
  const shared = emitCount >= 2 ? ' data-shared' : '';
  return `<script type="application/json" id="${id}"${shared}>${safe}</script>`;
}

/**
 * Insert one island's props block immediately before `el`, the first `<mochi-hydratable-island>` referencing it.
 * `ComponentRegistry`'s HTMLRewriter pass calls this for every island in document order: `propsById` maps a ref id to
 * its payload and emit count, while `emitted` records ids already written so islands sharing a byte-identical payload
 * reuse the one block. An island with no `props-ref`, or a ref absent from the registry, is left untouched.
 */
export function injectIslandPropsBlock(el: HTMLRewriterTypes.Element, propsById: Map<string, { json: string; emitCount: number }>, emitted: Set<string>): void {
  const ref = el.getAttribute('props-ref');
  if (!ref || emitted.has(ref)) {
    return;
  }
  const entry = propsById.get(ref);
  if (!entry) {
    return;
  }
  emitted.add(ref);
  el.before(renderIslandPropsScript(ref, entry.json, entry.emitCount), { html: true });
}
