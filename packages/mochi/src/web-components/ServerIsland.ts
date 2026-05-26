/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import './IslandFailure';
import { logger, setLogLevel } from '../log';
import '../debug-bar/types';
import { observeVisible } from './sharedVisibilityObserver';
import { isLoadedCss, markLoadedCss } from './sharedCssTracker';

// Inline-bundled separately from the main client bundle, so `setLogLevel` here
// is a fresh module instance — seed it from the global the server injected.
if (typeof window !== 'undefined' && window.__mochi_log_level) {
  setLogLevel(window.__mochi_log_level);
}

class ServerIsland extends HTMLElement {
  _loaded = false;

  connectedCallback() {
    if (this._loaded) {
      return;
    }
    this._loaded = true;

    if (this.getAttribute('defer-on') === 'visible') {
      const optionsRaw = this.getAttribute('server-options');
      const options = optionsRaw ? JSON.parse(optionsRaw) : {};
      // Observe firstElementChild because display:contents gives this element
      // no layout box. When no fallback children are provided, the global
      // `:empty { min-height: 1px }` rule on visible-deferred islands keeps
      // the wrapper itself observable.
      const target = this.firstElementChild || this;
      observeVisible(target, options.rootMargin || '0px', () => this._fetchContent());
      return;
    }

    this._fetchContent();
  }

  async _fetchContent() {
    const componentName = this.getAttribute('component-name');
    if (!componentName) {
      return;
    }

    const signedProps = this.getAttribute('signed-props');
    const alsoHydrate = this.getAttribute('also-hydrate') || '';
    // The SSR side stamps `data-asset-prefix` onto every <mochi-server-island>
    // element (via the __MOCHI_ASSET_PREFIX__ placeholder substitution in
    // ComponentRegistry) so the client can rebuild the /<prefix>/island/... URL.
    const assetPrefix = this.getAttribute('data-asset-prefix');
    let url = `${assetPrefix}/island/${encodeURIComponent(componentName)}`;
    const params = new URLSearchParams();
    if (signedProps) {
      params.set('props', signedProps);
    }
    if (alsoHydrate) {
      params.set('hydrate', alsoHydrate);
    }
    const qs = params.toString();
    if (qs) {
      url += `?${qs}`;
    }

    if (url.length > 1800) {
      window.__mochi_warn?.(`Server island "${componentName}" URL is ${url.length} chars. Consider reducing prop size.`);
    }

    const optionsRaw = this.getAttribute('server-options');
    const options = optionsRaw ? JSON.parse(optionsRaw) : {};
    const maxRetries = typeof options.retries === 'number' ? options.retries : 9;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) {
            throw Object.assign(new Error(`HTTP ${response.status}`), { abort: true });
          }
          throw new Error(`HTTP ${response.status}`);
        }
        const html = await response.text();

        logger.log(`Server island "${componentName}" loaded (attempt ${attempt}, ${(html.length / 1024).toFixed(1)}kB, alsoHydrate=${alsoHydrate || 'none'})`);

        const cssUrl = this.getAttribute('css-url');
        if (cssUrl && !isLoadedCss(cssUrl)) {
          markLoadedCss(cssUrl);
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = cssUrl;
          document.head.appendChild(link);
        }

        // SAFETY: HTML comes from our own same-origin server-island endpoint with HMAC-signed props.
        // If the island endpoint ever returns user-controlled content, this must be sanitized.
        this.innerHTML = html;
        return;
      } catch (err) {
        if (err instanceof Error && 'abort' in err) {
          throw err;
        }
        lastErr = err;
        logger.warn(`Server island "${componentName}" failed (attempt ${attempt}/${maxRetries + 1}): ${err}`);
        if (attempt <= maxRetries) {
          const delay = attempt <= 3 ? 1000 : attempt <= 6 ? 3000 : 5000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    const msg = `Server island "${componentName}" failed after ${maxRetries + 1} attempts: ${lastErr}`;
    logger.error(msg);
    window.__mochi_warn?.(msg);
  }
}

if (!customElements.get('mochi-server-island')) {
  customElements.define('mochi-server-island', ServerIsland);
}
