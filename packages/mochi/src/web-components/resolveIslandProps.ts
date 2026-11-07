/// <reference lib="dom" />

/**
 * Resolve a hydratable island's `props-ref` block. Props ids (`mochi-props-N`) are numbered per
 * render but a server island renders in its own request, so its counter restarts at 0 and collides
 * with the page's ids. Scoping the lookup to the enclosing `<mochi-server-island>` — the render that
 * emitted the block — keeps a nested island reading its own props; `closest` is `null` for an
 * ordinary page island, so it falls back to the document and nothing else changes.
 */
export function resolveIslandProps(el: Element, propsRef: string): string | null {
  const scope = el.closest('mochi-server-island');
  const block = scope?.querySelector(`#${CSS.escape(propsRef)}`) ?? document.getElementById(propsRef);
  return block?.textContent ?? null;
}
