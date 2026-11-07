// Stands in for the hydration bootstrap in the happy-dom test: records each evaluation and defines the
// hydratable element, so the test can see that the module ran and that the waiting island got upgraded.
/// <reference lib="dom" />
declare global {
  var __mochi_bootstrap_stub_runs: number | undefined;
}

globalThis.__mochi_bootstrap_stub_runs = (globalThis.__mochi_bootstrap_stub_runs ?? 0) + 1;

if (!customElements.get('mochi-hydratable-island')) {
  customElements.define(
    'mochi-hydratable-island',
    class extends HTMLElement {
      connectedCallback() {
        this.setAttribute('data-upgraded', '');
      }
    },
  );
}

export {};
