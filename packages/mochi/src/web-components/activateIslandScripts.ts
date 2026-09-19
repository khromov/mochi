/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

// Anything a browser treats as JavaScript; `application/json` island-props blocks and other data
// payloads deliberately fall outside it and stay where the server put them.
const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);

function srcOf(el: Element): string {
  return (el as HTMLScriptElement).src || el.getAttribute('src') || '';
}

/**
 * Server-island HTML is inserted with `innerHTML`, which leaves its `<script>` elements inert — so the
 * endpoint's hydration bootstrap never ran on a page whose only hydratable is deferred. Re-create each
 * external script as a live element in `<head>`, once per URL across the whole document.
 */
export function activateIslandScripts(root: Element): void {
  for (const inert of [...root.querySelectorAll('script[src]')]) {
    if (!EXECUTABLE_TYPES.has((inert.getAttribute('type') || '').toLowerCase())) {
      continue;
    }
    const src = srcOf(inert);
    inert.remove();
    if (!src || [...document.querySelectorAll('script[src]')].some((existing) => srcOf(existing) === src)) {
      continue;
    }
    const live = document.createElement('script');
    for (const attr of inert.attributes) {
      live.setAttribute(attr.name, attr.value);
    }
    document.head.appendChild(live);
  }
}
