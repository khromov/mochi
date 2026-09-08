import { stringify } from 'devalue';
import { getRequestContext } from '../runtime/requestContext';
import { pinGlobal } from '../utils/globalState';

/** One entry in the per-render dedup registry (`ctx.islandProps`): a unique serialized payload's ref id and how many islands emitted it. */
export interface IslandPropsEntry {
  id: string;
  emitCount: number;
}

type IslandPropsMap = Map<string, IslandPropsEntry>;

type EmittedBag = { value: Record<string, unknown>; entry: IslandPropsEntry };

// Pinned because the copy of the framework that clears a render's registry is often not the copy whose
// `emitIslandProps` filled it, and a bag outliving its payload map would name a block that render never emits.
const emittedBags = pinGlobal('__mochi_island_props_bags__', () => new WeakMap<IslandPropsMap, EmittedBag[]>());

/** Only a bag devalue would accept can stand in for one it already serialized, so anything it rejects must reach it and throw. */
function isPlainBag(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return (proto === Object.prototype || proto === null) && Object.getOwnPropertySymbols(value).length === 0;
}

/** `Object.is` is what makes this safe to substitute for comparing serialized bytes: it separates `0` from `-0`, which devalue round-trips apart. */
function sameBag(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/** The bag list has to be dropped with the payload map it indexes, or a surviving entry names a block the next render never emits. */
export function clearIslandProps(ctx: { islandProps: IslandPropsMap }): void {
  ctx.islandProps.clear();
  emittedBags.delete(ctx.islandProps);
}

/**
 * Serialize a hydratable island's props via devalue and register them in the per-render dedup registry, returning the
 * stable ref id the preprocessor emits as `props-ref`. After SSR, `ComponentRegistry`'s HTMLRewriter pass writes each
 * payload as a `<script type="application/json" id="mochi-props-N">` block just before the first island referencing it.
 *
 * Two islands with byte-identical serialized JSON share one ref id — the whole dedup mechanism — and the per-id emit
 * count lets the render pass flag genuinely shared blocks. Server islands take the preprocessor's own branch instead,
 * since their `signed-props` payloads are encrypted and travel through URL query strings.
 *
 * Props reached through the identity fast path are assumed not to be mutated between two call sites inside one
 * `render()`; a render that did that would get one shared block where it wanted two.
 */
export function emitIslandProps(value: unknown): string {
  const ctx = getRequestContext();

  // Serializing is how a duplicate is found, so it is paid for before it is discovered.
  const bags = emittedBags.get(ctx.islandProps);
  if (bags && isPlainBag(value)) {
    for (const bag of bags) {
      if (sameBag(bag.value, value)) {
        bag.entry.emitCount++;
        return bag.entry.id;
      }
    }
  }

  const json = stringify(value);
  let entry = ctx.islandProps.get(json);
  if (!entry) {
    entry = { id: `mochi-props-${ctx.islandProps.size}`, emitCount: 0 };
    ctx.islandProps.set(json, entry);
  }
  entry.emitCount++;

  if (isPlainBag(value)) {
    const list = bags ?? [];
    list.push({ value, entry });
    emittedBags.set(ctx.islandProps, list);
  }
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
