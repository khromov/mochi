/// <reference lib="dom" />

/**
 * Resolve a hydratable island's `props-ref` block. Only the framework's own `<script type="application/json">` counts, so
 * page content that merely carries the id (user HTML through an id-preserving sanitizer) cannot supply an island's props.
 * Scoping to the enclosing `<mochi-server-island>` covers a fragment whose ids were not namespaced by its render.
 */
export function resolveIslandProps(el: Element, propsRef: string): string | null {
  const selector = `script[type="application/json"]#${CSS.escape(propsRef)}`;
  const block = el.closest('mochi-server-island')?.querySelector(selector) ?? document.querySelector(selector);
  return block?.textContent ?? null;
}
