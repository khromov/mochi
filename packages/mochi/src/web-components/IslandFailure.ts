/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

class IslandFailure extends HTMLElement {}

if (typeof customElements !== 'undefined' && !customElements.get('mochi-island-failure')) {
  customElements.define('mochi-island-failure', IslandFailure);
}
