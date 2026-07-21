/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import '../debug-bar/types';

// Key must match sharedCssTracker.ts for cross-bundle dedup with HydratableIsland.
const _css: Set<string> = ((globalThis as unknown as Record<string, unknown>).__mochi_loaded_css__ ??= new Set()) as Set<string>;

class ServerIsland extends HTMLElement {
  _loaded = false;

  connectedCallback() {
    if (this._loaded) {
      return;
    }
    this._loaded = true;

    const optionsRaw = this.getAttribute('server-options');
    const options = optionsRaw ? JSON.parse(optionsRaw) : {};

    if (this.getAttribute('defer-on') === 'visible') {
      // Observe firstElementChild because display:contents gives this element
      // no layout box. When no fallback children are provided, the global
      // `:empty { min-height: 1px }` rule on visible-deferred islands keeps
      // the wrapper itself observable.
      const target = this.firstElementChild || this;
      new IntersectionObserver(
        (entries, obs) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              obs.disconnect();
              this._fetchContent(options);
              return;
            }
          }
        },
        { rootMargin: options.rootMargin || '0px' },
      ).observe(target);
      return;
    }

    this._fetchContent(options);
  }

  async _fetchContent(options: Record<string, unknown> = {}) {
    const g = (k: string) => this.getAttribute(k);
    const componentName = g('component-name');
    if (!componentName) {
      return;
    }

    const tag = `[mochi] Server island "${componentName}"`;
    const ll = window.__mochi_log_level;
    const signedProps = g('signed-props');
    const alsoHydrate = g('also-hydrate') || '';
    const assetPrefix = g('data-asset-prefix');
    let url = `${assetPrefix}/island/${encodeURIComponent(componentName)}`;
    const params = new URLSearchParams();
    if (signedProps) {
      params.set('props', signedProps);
    }
    const qs = params.toString();
    if (qs) {
      url += `?${qs}`;
    }

    if (url.length > 1800) {
      window.__mochi_warn?.(`${tag} URL is ${url.length} chars. Consider reducing prop size.`);
    }

    const maxRetries = typeof options.retries === 'number' ? options.retries : 9;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) {
            throw Object.assign(new Error(`HTTP ${response.status}`), { abort: true });
          }
          throw new Error(`HTTP ${response.status}`);
        }
        const html = await response.text();

        if (ll === 'log' || ll === 'debug') {
          console.log(`${tag} loaded (attempt ${attempt}, ${(html.length / 1024).toFixed(1)}kB, alsoHydrate=${alsoHydrate || 'none'})`);
        }

        const cssUrl = g('css-url');
        if (cssUrl && !_css.has(cssUrl)) {
          _css.add(cssUrl);
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = cssUrl;
          document.head.appendChild(link);
        }

        // SAFETY: HTML comes from our own same-origin server-island endpoint with encrypted props.
        // If the island endpoint ever returns user-controlled content, this must be sanitized.
        this.innerHTML = html;
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && 'abort' in err) {
          // A 4xx is deterministic — retrying won't help. Stop the loop and fall
          // through to the failure reporting below rather than rethrowing out of
          // this (unawaited) async method, which would surface as an unhandled
          // rejection and leave the island silently stuck on its fallback.
          break;
        }
        if (ll !== 'silent' && ll !== 'error') {
          console.warn(`${tag} failed (attempt ${attempt}/${maxRetries + 1}): ${err}`);
        }
        if (attempt <= maxRetries) {
          const delay = attempt <= 3 ? 1000 : attempt <= 6 ? 3000 : 5000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    const msg = `${tag} failed after ${maxRetries + 1} attempts: ${lastErr}`;
    if (ll !== 'silent') {
      console.error(msg);
    }
    window.__mochi_warn?.(msg);
  }
}

if (!customElements.get('mochi-server-island')) {
  customElements.define('mochi-server-island', ServerIsland);
}
