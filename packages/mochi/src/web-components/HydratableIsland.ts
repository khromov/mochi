/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { hydrate, mount } from 'svelte';
import type { Component } from 'svelte';
import { parse as devalueParse } from 'devalue';
import { isDev, logger } from 'mochi-framework';
import './IslandFailure';
import { islandFailureStub } from './islandFailureStub';
import { observeVisible } from './sharedVisibilityObserver';
import { isLoadedCss, markLoadedCss } from './sharedCssTracker';

const componentRegistry: Record<string, Component> = {};

export function registerComponent(name: string, component: Component) {
  componentRegistry[name] = component;
}

class HydratableIsland extends HTMLElement {
  _hydrated = false;

  connectedCallback() {
    const name = this.getAttribute('component-name');
    const hydrateOn = this.getAttribute('hydrate-on');
    logger.log('connectedCallback', {
      name,
      hydrateOn,
      attributes: [...this.attributes].map((a) => a.name + '=' + a.value),
    });
    if (this._hydrated) {
      return;
    }
    if (hydrateOn === 'visible') {
      const optionsRaw = this.getAttribute('hydrate-options');
      const options = optionsRaw ? JSON.parse(optionsRaw) : {};
      // Observe firstElementChild because display:contents gives this element no layout box
      const target = this.firstElementChild || this;
      observeVisible(target, options.rootMargin || '0px', () => this._doHydrate());
    } else {
      // Eager islands: load component JS immediately, then hydrate
      this._doHydrate();
    }
  }

  async _doHydrate() {
    if (this._hydrated) {
      return;
    }
    this._hydrated = true;
    const name = this.getAttribute('component-name');
    try {
      await this._doHydrateInner(name);
    } catch (err) {
      // Defensive belt — `transformError` on `hydrate()` covers errors raised
      // by the boundary; this catches synchronous throws from the bundle import,
      // CSS load, or `hydrate()` itself before the boundary takes effect.
      const e = err instanceof Error ? err : new Error(String(err));
      logger.error(`Island "${name}" failed to hydrate:`, e);
      this.innerHTML = islandFailureStub(name ?? '', isDev ? e.message : undefined);
    }
  }

  async _doHydrateInner(name: string | null) {
    if (!name) {
      return;
    }
    // Page islands carry a `props-ref` pointing at a
    // <script type="application/json" id="<propsRef>"> block emitted just before
    // them. The server-island also-hydrate path instead inlines `props=...`
    // directly, so fall back to that attribute when no ref is present.
    const propsRef = this.getAttribute('props-ref');
    let propsRaw: string | null;
    if (propsRef) {
      propsRaw = document.getElementById(propsRef)?.textContent ?? null;
    } else {
      propsRaw = this.getAttribute('props');
    }
    const componentUrl = this.getAttribute('component-url');
    const cssUrl = this.getAttribute('css-url');

    logger.log('_doHydrate', {
      name,
      hasComponent: !!componentRegistry[name],
      componentUrl,
      cssUrl,
      propsRaw,
    });

    // Load deferred CSS if present (lazy islands) — once per URL
    if (cssUrl && !isLoadedCss(cssUrl)) {
      markLoadedCss(cssUrl);
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to load CSS: ${cssUrl}`));
        document.head.appendChild(link);
      });
    }

    // Load the component's JS bundle (calls registerComponent on import)
    if (!componentRegistry[name] && componentUrl) {
      logger.log('Loading component', name, componentUrl);
      await import(componentUrl);
    }

    const Component = componentRegistry[name];
    if (!Component) {
      return;
    }
    let props: Record<string, unknown>;
    try {
      props = propsRaw ? devalueParse(propsRaw) : {};
    } catch (err) {
      if (propsRaw && err instanceof SyntaxError) {
        const m = err.message.match(/position (\d+)/);
        const pos = m ? Number(m[1]) : -1;
        if (pos >= 0) {
          const ch = propsRaw.charCodeAt(pos);
          const around = propsRaw.slice(Math.max(0, pos - 20), pos + 20);
          logger.error(`Failed to parse props for "${name}" at position ${pos} (char U+${ch.toString(16).padStart(4, '0')}, len=${propsRaw.length}):`, JSON.stringify(around));
        } else {
          logger.error(`Failed to parse props for "${name}" (len=${propsRaw.length}):`, err.message);
        }
      }
      throw err;
    }
    // `transformError` makes <svelte:boundary> work for client-side errors
    // (e.g. throws inside $effect / $derived after hydration). Returns an
    // Error instance — same shape as the SSR transformError — so user-written
    // `failed` snippets can rely on `error instanceof Error`. `message` is
    // made enumerable to match SSR (see ComponentRegistry transformError).
    const transformError = (err: unknown): Error => {
      const e = err instanceof Error ? err : new Error(String(err));
      logger.error(`Island "${name}" runtime error:`, e);
      const out = isDev ? e : new Error('Island error');
      Object.defineProperty(out, 'message', {
        value: out.message,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return out;
    };
    const clientOnly = this.hasAttribute('client-only');
    if (clientOnly) {
      // mochi:clientOnly islands have no SSR HTML — the wrapper holds optional
      // fallback content. Remove it exactly when the real component mounts.
      this.innerHTML = '';
      mount(Component, { target: this, props, transformError });
    } else {
      hydrate(Component, { target: this, props, transformError });
    }
    logger.log(clientOnly ? 'Mounted' : 'Hydrated', name);
  }
}

if (!customElements.get('mochi-hydratable-island')) {
  customElements.define('mochi-hydratable-island', HydratableIsland);
}
