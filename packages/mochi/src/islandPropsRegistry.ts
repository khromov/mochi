import { stringify } from 'devalue';
import { Packr } from 'msgpackr';
import { getRequestContext } from './requestContext';
import { getMochiConfig } from './mochiConfig';

// `structuredClone` reaches devalue parity for Date/Map/Set/undefined and cyclic
// or repeated references — see packages/mochi/REPORT.md.
const packr = new Packr({ structuredClone: true });

/**
 * Resolve the experimental island-props codec. Defaults to `'devalue'`; opt into
 * `'msgpack'` via `Mochi.serve({ islandPropsCodec })` or `MOCHI_ISLAND_CODEC`.
 * Read here (server-only) rather than threaded through every call site, since the
 * choice is a single per-server setting.
 */
function resolveCodec(): 'devalue' | 'msgpack' {
  let codec: string | undefined;
  try {
    codec = getMochiConfig().options.islandPropsCodec;
  } catch {
    // Config not initialized yet (shouldn't happen during a request) — fall through.
  }
  codec = codec ?? process.env.MOCHI_ISLAND_CODEC;
  return codec === 'msgpack' ? 'msgpack' : 'devalue';
}

/**
 * One entry in the per-request island props dedup registry
 * (`ctx.islandProps`): the ref id assigned to a unique serialized payload and
 * the number of islands that emitted that exact payload.
 */
export interface IslandPropsEntry {
  id: string;
  emitCount: number;
}

/**
 * Serialize a hydratable island's props via devalue and register them in the
 * per-request dedup registry. Returns a stable ref id (e.g. "mochi-props-3")
 * that the preprocessor emits as the `props-ref` attribute. After SSR,
 * `ComponentRegistry`'s HTMLRewriter pass emits each payload as a
 * `<script type="application/json" id="mochi-props-N">` block placed just
 * before the first island that references it.
 *
 * Two islands whose serialized JSON is byte-identical share the same ref id;
 * that's the entire dedup mechanism. The per-id emit count lets the render pass
 * flag blocks that more than one island actually shares.
 *
 * Server islands intentionally do NOT use this path. Their `signed-props`
 * payloads are HMAC-signed and travel through URL query strings, so they keep
 * using `stringify` directly via the preprocessor's server-island branch.
 */
export function emitIslandProps(value: unknown): string {
  // `payload` is the text actually embedded in the block: devalue JSON, or
  // base64(msgpackr) under the experimental msgpack codec. Dedup keys on it, so
  // byte-identical payloads still share one block under either codec.
  const payload = resolveCodec() === 'msgpack' ? Buffer.from(packr.pack(value)).toString('base64') : stringify(value);
  const ctx = getRequestContext();
  let entry = ctx.islandProps.get(payload);
  if (!entry) {
    entry = { id: `mochi-props-${ctx.islandProps.size}`, emitCount: 0 };
    ctx.islandProps.set(payload, entry);
  }
  entry.emitCount++;
  return entry.id;
}

/**
 * Render the `<script type="application/json" id="mochi-props-N">` block that
 * carries one island's deduplicated props. `ComponentRegistry`'s HTMLRewriter
 * pass calls this once per unique payload and inserts the result immediately
 * before the first `<mochi-hydratable-island>` that references it. Blocks
 * reused by two or more islands carry a `data-shared` marker so the dev toolbar
 * can flag genuinely deduplicated props without re-counting refs across the
 * DOM — a lone island's block stays unmarked.
 *
 * Every `<` inside the JSON is escaped to its `<` JSON unicode escape so
 * the HTML script-data tokenizer (which ignores `type="application/json"`)
 * cannot see a `</script` sequence and terminate the block early.
 */
export function renderIslandPropsScript(id: string, payload: string, emitCount: number): string {
  const safe = payload.replace(/</g, '\\u003C');
  const shared = emitCount >= 2 ? ' data-shared' : '';
  // Self-describing block: the client reads the script element's type/data-enc to
  // pick a decoder, so no per-request codec config needs to reach the browser.
  // (base64 contains no `<`, so the escape above is a no-op under the msgpack codec.)
  if (resolveCodec() === 'msgpack') {
    return `<script type="application/x-mochi-msgpack" data-enc="base64" id="${id}"${shared}>${safe}</script>`;
  }
  return `<script type="application/json" id="${id}"${shared}>${safe}</script>`;
}

/**
 * Insert one island's props block immediately before `el` — the first
 * `<mochi-hydratable-island>` that references it. `ComponentRegistry`'s
 * HTMLRewriter pass calls this for every island in document order: `propsById`
 * maps a ref id to its payload + emit count, and `emitted` records ids already
 * written so islands sharing a byte-identical payload reuse the single block
 * emitted before the first of them. Islands with no `props-ref` — or a ref
 * absent from the registry, e.g. the server-island also-hydrate path that
 * inlines `props=` — are left untouched.
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
