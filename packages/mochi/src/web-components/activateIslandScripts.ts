/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

// Anything a browser treats as JavaScript; `application/json` island-props blocks and other data
// payloads deliberately fall outside it and stay where the server put them.
const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);

/**
 * Server-island HTML is inserted with `innerHTML`, which leaves its `<script>` elements inert — so the
 * endpoint's hydration bootstrap never ran on a page whose only hydratable is deferred. Re-create each
 * external script as a live element in `<head>` and report whether any was; the caller owns the
 * once-per-document gate, so nothing here looks beyond `root`.
 */
export function activateIslandScripts(root: Element): boolean {
  let activated = false;
  for (const inert of [...root.querySelectorAll('script[src]')]) {
    if (!EXECUTABLE_TYPES.has((inert.getAttribute('type') || '').toLowerCase())) {
      continue;
    }
    inert.remove();
    const live = document.createElement('script');
    for (const attr of inert.attributes) {
      live.setAttribute(attr.name, attr.value);
    }
    document.head.appendChild(live);
    activated = true;
  }
  return activated;
}
