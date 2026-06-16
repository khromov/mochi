import {
  HTMLElement as HTMLElementShim,
  customElements as customElementsShim,
  CustomElementRegistry as CustomElementRegistryShim,
  ElementInternals as ElementInternalsShim,
  ShadowRoot as ShadowRootShim,
} from '@lit-labs/ssr-dom-shim';
import { pinGlobal } from './globalState.ts';

// Custom-element definition modules reference `HTMLElement` and call
// `customElements.define()` at module-eval time, which crashes on Bun's server
// runtime where those globals don't exist. Installing minimal shims lets such
// modules — local ones and external npm packages alike — be imported during SSR
// with a plain `import`, instead of being gated behind `if (isBrowser)`.
//
// Svelte never instantiates custom elements server-side (it only renders the
// tag string), so the shims only need to satisfy class definition and
// `customElements.define()`, not full DOM behaviour.
export function installCustomElementsShim(): void {
  pinGlobal('__mochi_ce_shim__', () => {
    const g = globalThis as unknown as Record<string, unknown>;
    // `??=` so we never clobber a real browser global (or a prior install).
    // Deliberately NOT shimming `window`, `document`, `Element`, or `Node`:
    // those are the sentinels isomorphic libraries use to detect the browser
    // (`typeof window`, `typeof document`), so leaving them undefined keeps
    // server-side feature detection correct.
    g.HTMLElement ??= HTMLElementShim;
    g.customElements ??= customElementsShim;
    g.CustomElementRegistry ??= CustomElementRegistryShim;
    g.ElementInternals ??= ElementInternalsShim;
    g.ShadowRoot ??= ShadowRootShim;
    return true;
  });
}
