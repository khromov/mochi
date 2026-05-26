/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import '../debug-bar/types';

// Key must match sharedCssTracker.ts for cross-bundle dedup with HydratableIsland.
const _css: Set<string> = ((globalThis as unknown as Record<string, unknown>).__mochi_loaded_css__ ??= new Set()) as Set<string>;

const _tag = 'mochi-server-island';

class ServerIsland extends HTMLElement {
  _?: true;

  connectedCallback() {
    if (this._) {
      return;
    }
    this._ = true;

    const g = (k: string) => this.getAttribute(k);
    const raw = g('server-options');
    const options = raw ? JSON.parse(raw) : {};

    const f = async () => {
      const componentName = g('component-name');
      if (!componentName) {
        return;
      }

      const tag = `[mochi] Server island "${componentName}"`;
      const ll = window.__mochi_log_level;
      const signedProps = g('signed-props');
      const alsoHydrate = g('also-hydrate') || '';
      let url = `${g('data-asset-prefix')}/island/${encodeURIComponent(componentName)}`;
      let qs = signedProps ? 'props=' + signedProps : '';
      if (alsoHydrate) {
        qs += (qs ? '&' : '') + 'hydrate=' + alsoHydrate;
      }
      if (qs) {
        url += '?' + qs;
      }

      if (url.length > 1800) {
        window.__mochi_warn?.(`${tag} URL is ${url.length} chars. Consider reducing prop size.`);
      }

      const total = ((options.retries as number | undefined) ?? 9) + 1;

      let lastErr: unknown;
      for (let attempt = 1; attempt <= total; attempt++) {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw response.status;
          }
          const html = await response.text();

          if (ll === 'log' || ll === 'debug') {
            console.log(`${tag} loaded (attempt ${attempt}, ${(html.length / 1024).toFixed(1)}kB, alsoHydrate=${alsoHydrate || 'none'})`);
          }

          const cssUrl = g('css-url');
          if (cssUrl && !_css.has(cssUrl)) {
            _css.add(cssUrl);
            document.head.insertAdjacentHTML('beforeend', `<link rel=stylesheet href="${cssUrl}">`);
          }

          // SAFETY: HTML comes from our own same-origin server-island endpoint with HMAC-signed props.
          this.innerHTML = html;
          return;
        } catch (err) {
          if ((err as number) >= 400 && (err as number) < 500) {
            throw err;
          }
          lastErr = err;
          if (ll !== 'silent' && ll !== 'error') {
            console.warn(`${tag} failed (attempt ${attempt}/${total}): ${err}`);
          }
          if (attempt < total) {
            const delay = attempt <= 3 ? 1e3 : attempt <= 6 ? 3e3 : 5e3;
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      const msg = `${tag} failed after ${total} attempts: ${lastErr}`;
      if (ll !== 'silent') {
        console.error(msg);
      }
      window.__mochi_warn?.(msg);
    };

    if (g('defer-on') === 'visible') {
      // display:contents gives this element no layout box — observe firstElementChild instead.
      const target = this.firstElementChild || this;
      new IntersectionObserver(
        (entries, obs) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              obs.disconnect();
              f();
              return;
            }
          }
        },
        { rootMargin: options.rootMargin || '0px' },
      ).observe(target);
      return;
    }

    f();
  }
}

if (!customElements.get(_tag)) {
  customElements.define(_tag, ServerIsland);
}
