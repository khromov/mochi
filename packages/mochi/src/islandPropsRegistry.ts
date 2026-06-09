import { stringify } from 'devalue';
import { logger } from './log';
import { getRequestContext } from './requestContext';

/**
 * Serialize a hydratable island's props via devalue and register them in the
 * per-request dedup registry. Returns a stable ref id (e.g. "mochi-props-3")
 * that the preprocessor emits as the `props-ref` attribute. After SSR,
 * `ComponentRegistry` rewrites single-use payloads to an inline `props`
 * attribute (via `inlineSingleUseProps`) and hoists payloads shared by two or
 * more islands into `<script type="application/json" id="mochi-props-N">`
 * blocks.
 *
 * Two islands whose serialized JSON is byte-identical share the same ref id;
 * that's the entire dedup mechanism.
 *
 * If `islandId` is supplied and `ctx.debugBarData` is initialized (dev mode),
 * the pretty-printed JSON is also recorded under `debugBarData.islandProps`
 * keyed by islandId so the dev toolbar can render it without a post-render
 * HTML scan.
 *
 * Server islands intentionally do NOT use this path. Their `signed-props`
 * payloads are HMAC-signed and travel through URL query strings, so they keep
 * using `stringify` directly via the preprocessor's server-island branch.
 */
export function emitIslandProps(value: unknown, islandId?: string): string {
  const json = stringify(value);
  const ctx = getRequestContext();
  let entry = ctx.islandProps.get(json);
  if (!entry) {
    entry = { id: `mochi-props-${ctx.islandProps.size}`, count: 0 };
    ctx.islandProps.set(json, entry);
  }
  entry.count++;
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
  return entry.id;
}

/**
 * Build the `<script type="application/json">` blocks that carry props shared
 * by two or more islands on a single rendered page; single-use payloads are
 * inlined by `inlineSingleUseProps` instead and get no block. Caller is
 * responsible for prepending the result to the rendered body. Every `<` inside
 * the JSON is escaped to its `<` JSON unicode escape so the HTML
 * script-data tokenizer (which ignores `type="application/json"`) cannot see a
 * `</script` sequence and terminate the block early.
 */
export function buildIslandPropsScripts(registry: Map<string, { id: string; count: number }>): string {
  let out = '';
  for (const [json, entry] of registry) {
    if (entry.count < 2) {
      continue;
    }
    const safe = json.replace(/</g, '\\u003C');
    out += `<script type="application/json" id="${entry.id}">${safe}</script>`;
  }
  return out;
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Rewrite `props-ref="mochi-props-N"` to an inline `props="…"` attribute for
 * every payload emitted by exactly one island, so the shared-block indirection
 * only exists when something is actually shared. The match is anchored to the
 * `<mochi-hydratable-island` start tag because Svelte does not escape `"` in
 * text nodes — page prose could otherwise contain a literal
 * `props-ref="mochi-props-0"` — while a raw `<` can never appear in
 * Svelte-escaped text. `[^>]*?` is safe because the preprocessor emits
 * `props-ref` before `hydrate-options`, the only island attribute whose value
 * can contain `>`.
 */
export function inlineSingleUseProps(html: string, registry: Map<string, { id: string; count: number }>): string {
  const inline = new Map<string, string>();
  for (const [json, entry] of registry) {
    if (entry.count === 1) {
      inline.set(entry.id, json);
    }
  }
  if (inline.size === 0) {
    return html;
  }
  return html.replace(/(<mochi-hydratable-island\b[^>]*?) props-ref="(mochi-props-\d+)"/g, (m, prefix: string, id: string) => {
    const json = inline.get(id);
    return json === undefined ? m : `${prefix} props="${escapeHtmlAttr(json)}"`;
  });
}
