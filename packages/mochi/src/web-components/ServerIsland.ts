/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import '../debug-bar/types';
import { isReloadableIslandName, notifyDeferredIslandChange, registerDeferredIsland, unregisterDeferredIsland } from '../islands/deferInvalidation';

// Key must match sharedCssTracker.ts for cross-bundle dedup with HydratableIsland.
const _css: Set<string> = ((globalThis as unknown as Record<string, unknown>).__mochi_loaded_css__ ??= new Set()) as Set<string>;

class ServerIsland extends HTMLElement {
  _loaded = false;
  _options: Record<string, unknown> = {};
  _name: string | null = null;
  _inflight: Promise<boolean> | null = null;
  _everLoaded = false;

  connectedCallback() {
    if (this._loaded) {
      // Re-registered from the stored name, not the attribute, so a moved element stays
      // reachable by `reloadDeferredIsland` even if `server-options` was mangled in transit.
      if (this._name) {
        registerDeferredIsland(this._name, this);
      }
      return;
    }
    this._loaded = true;

    const optionsRaw = this.getAttribute('server-options');
    const options = optionsRaw ? JSON.parse(optionsRaw) : {};
    this._options = options;

    if (isReloadableIslandName(options.name)) {
      this._name = options.name;
      registerDeferredIsland(options.name, this);
    } else if (options.name !== undefined) {
      window.__mochi_warn?.(`[mochi] mochi:defer name must be a non-empty string; got ${JSON.stringify(options.name)} — the island will not be reloadable.`);
    }

    if (this.getAttribute('defer-on') === 'visible') {
      // `display:contents` leaves this element without a layout box, so the firstElementChild is observed instead; with
      // no fallback children, the global `:empty { min-height: 1px }` rule keeps the wrapper itself observable.
      const target = this.firstElementChild || this;
      new IntersectionObserver(
        (entries, obs) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              obs.disconnect();
              // Queued behind any manual reload already running so the two can never race, and
              // skipped when one of them has already delivered content.
              this._track((this._inflight ?? Promise.resolve(true)).then(() => this._everLoaded || this._fetchContent(this._options)));
              return;
            }
          }
        },
        { rootMargin: options.rootMargin || '0px' },
      ).observe(target);
      return;
    }

    this._track(this._fetchContent(options));
  }

  disconnectedCallback() {
    if (this._name) {
      unregisterDeferredIsland(this._name, this);
    }
  }

  // Svelte roots outlive their DOM, so a discarded subtree keeps running without this.
  _unmountChildren() {
    for (const el of this.querySelectorAll('mochi-hydratable-island')) {
      const island = el as { _unmount?: () => void; _generation?: number };
      // Bumped so a hydration whose bundle import is still in flight bails instead of mounting
      // a permanently-orphaned root onto the discarded subtree.
      island._generation = (island._generation ?? 0) + 1;
      island._unmount?.();
    }
  }

  _notify(change: { ok?: boolean } = {}) {
    if (this._name) {
      notifyDeferredIslandChange(this._name, change);
    }
  }

  // Notified from here, not inside the operation, so a notification never reports a stale `_inflight`.
  _track(op: Promise<boolean>): Promise<boolean> {
    const tracked = op
      .then(
        (ok) => ok === true,
        () => false,
      )
      .then((ok) => {
        if (this._inflight === tracked) {
          this._inflight = null;
        }
        this._notify();
        return ok;
      });
    this._inflight = tracked;
    this._notify();
    return tracked;
  }

  // Queued behind any fetch already running rather than sharing it, so a reload issued after a
  // mutation observes it and a late-landing fetch cannot clobber newer content. The outcome
  // travels through the returned promise; `reloadDeferredIsland` aggregates it per round.
  reload(): Promise<boolean> {
    return this._track((this._inflight ?? Promise.resolve(true)).then(() => this._reload()));
  }

  async _reload(): Promise<boolean> {
    this.setAttribute('data-reloading', '');
    this.setAttribute('aria-busy', 'true');
    try {
      // The current content stays up until the new HTML lands: swapping to the fallback would
      // discard hydrated children's client state even when the fetch succeeds.
      return await this._fetchContent(this._options);
    } finally {
      this.removeAttribute('data-reloading');
      this.removeAttribute('aria-busy');
    }
  }

  isReloading(): boolean {
    return this._inflight !== null;
  }

  async _fetchContent(options: Record<string, unknown> = {}): Promise<boolean> {
    const componentName = this.getAttribute('component-name');
    if (!componentName) {
      return false;
    }

    const tag = `[mochi] Server island "${componentName}"`;
    const ll = window.__mochi_log_level;
    const alsoHydrate = this.getAttribute('also-hydrate') || '';
    const url = buildIslandFetchUrl(componentName, this.getAttribute('signed-props'), this.getAttribute('data-asset-prefix'), tag);
    const maxRetries = typeof options.retries === 'number' ? options.retries : 9;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const html = await this._loadIslandHtml(url);
        this._applyIslandResponse(html, alsoHydrate, tag, ll, attempt);
        return true;
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && 'abort' in err) {
          // A 4xx is deterministic, so the loop stops and falls through to the failure reporting below; rethrowing out
          // of this unawaited async method would surface as an unhandled rejection with the island stuck on its fallback.
          break;
        }
        if (ll !== 'silent' && ll !== 'error') {
          console.warn(`${tag} failed (attempt ${attempt}/${maxRetries + 1}): ${err}`);
        }
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, islandRetryDelayMs(attempt)));
        }
      }
    }

    const msg = `${tag} failed after ${maxRetries + 1} attempts: ${lastErr}`;
    if (ll !== 'silent') {
      console.error(msg);
    }
    window.__mochi_warn?.(msg);
    return false;
  }

  async _loadIslandHtml(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { abort: true });
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  }

  _applyIslandResponse(html: string, alsoHydrate: string, tag: string, ll: string | undefined, attempt: number): void {
    if (ll === 'log' || ll === 'debug') {
      console.log(`${tag} loaded (attempt ${attempt}, ${(html.length / 1024).toFixed(1)}kB, alsoHydrate=${alsoHydrate || 'none'})`);
    }

    const cssUrl = this.getAttribute('css-url');
    if (cssUrl && !_css.has(cssUrl)) {
      _css.add(cssUrl);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssUrl;
      document.head.appendChild(link);
    }

    this._unmountChildren();

    // SAFETY: HTML comes from our own same-origin server-island endpoint with encrypted props.
    // If the island endpoint ever returns user-controlled content, this must be sanitized.
    this.innerHTML = html;
    this._everLoaded = true;
  }
}

function buildIslandFetchUrl(componentName: string, signedProps: string | null, assetPrefix: string | null, tag: string): string {
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
  return url;
}

function islandRetryDelayMs(attempt: number): number {
  return attempt <= 3 ? 1000 : attempt <= 6 ? 3000 : 5000;
}

if (!customElements.get('mochi-server-island')) {
  customElements.define('mochi-server-island', ServerIsland);
}
