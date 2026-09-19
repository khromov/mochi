/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import '../debug-bar/types';
import { isReloadableIslandName, notifyDeferredIslandChange, registerDeferredIsland, unregisterDeferredIsland } from '../islands/deferInvalidation';

/** The slice of `ServerIsland` a group drives, structural so this module never imports the element class that imports it. */
export interface GroupMember {
  getAttribute(name: string): string | null;
  _name: string | null;
  _applyHtml(html: string): void;
}

// Members upgrade before the coordinator that follows them in the document, so they park here under the render-scoped
// `server-group` id and the coordinator claims them on connect. On globalThis for the same reason as the island CSS
// set: the inline island script and the hydration bundle are separate bundles that share state only through it.
const g = globalThis as unknown as Record<string, unknown>;
const members = (g.__mochi_island_group_members__ ??= new Map<string, Set<GroupMember>>()) as Map<string, Set<GroupMember>>;
const groups = (g.__mochi_island_groups__ ??= new Map<string, IslandGroup>()) as Map<string, IslandGroup>;

export function registerGroupMember(groupId: string, member: GroupMember): void {
  let set = members.get(groupId);
  if (!set) {
    set = new Set();
    members.set(groupId, set);
  }
  set.add(member);
}

export function unregisterGroupMember(groupId: string, member: GroupMember): void {
  const set = members.get(groupId);
  if (set?.delete(member) && set.size === 0) {
    // A swapped-out island fragment takes its whole group with it; dropping the empty set keeps the map from growing.
    members.delete(groupId);
  }
}

export function findIslandGroup(groupId: string): IslandGroup | undefined {
  return groups.get(groupId);
}

interface GroupResponse {
  m: Record<string, string>;
}

/**
 * Coordinator for one `mochi:defer={{ group }}` group: fetches every member's HTML in a single request (or one per
 * sealed chunk, when the group was too large for one URL) and swaps each fragment into the wrapper that claims its id.
 *
 * Emitted after its members so `connectedCallback` runs with the whole group parsed, which is what makes the fetch
 * cover all of them. Members never fetch on their own — they delegate `reload()` here too, so a reload of any one of
 * them (or of the group name) is still one request.
 */
export class IslandGroup extends HTMLElement {
  _started = false;
  _name = '';
  _groupId = '';
  _chunks: string[] = [];
  _options: Record<string, unknown> = {};
  _inflight: Promise<boolean> | null = null;
  _coalesced: Promise<boolean> | null = null;
  _everLoaded = false;

  connectedCallback() {
    if (this._started) {
      // Re-registered from the stored values, not the attributes, so a moved coordinator stays reachable even if they
      // were mangled in transit.
      groups.set(this._groupId, this);
      if (this._name) {
        registerDeferredIsland(this._name, this);
      }
      return;
    }
    this._started = true;

    this._name = this.getAttribute('group') || '';
    this._groupId = this.getAttribute('group-id') || '';
    this._chunks = (this.getAttribute('chunks') || '').split(' ').filter(Boolean);
    const optionsRaw = this.getAttribute('server-options');
    this._options = optionsRaw ? JSON.parse(optionsRaw) : {};
    groups.set(this._groupId, this);

    // The group name doubles as a reload handle, so `reloadDeferredIsland('stars')` reloads the group as one request.
    if (isReloadableIslandName(this._name)) {
      registerDeferredIsland(this._name, this);
    }

    if (this.getAttribute('defer-on') === 'visible') {
      // Only when every member is `mochi:defer:visible`; the group is the fetch unit, so the first member to scroll
      // into view brings the rest with it.
      const observer = new IntersectionObserver(
        (entries, obs) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              obs.disconnect();
              this._track((this._inflight ?? Promise.resolve(true)).then(() => this._everLoaded || this._fetchGroup()));
              return;
            }
          }
        },
        { rootMargin: typeof this._options.rootMargin === 'string' ? this._options.rootMargin : '0px' },
      );
      for (const member of this._members()) {
        // `display:contents` leaves a wrapper without a layout box, so its first child is observed instead; with no
        // fallback children the global `:empty { min-height: 1px }` rule keeps the wrapper itself observable.
        const el = member as unknown as Element;
        observer.observe(el.firstElementChild || el);
      }
      return;
    }

    this._track(this._fetchGroup());
  }

  disconnectedCallback() {
    if (groups.get(this._groupId) === this) {
      groups.delete(this._groupId);
    }
    if (this._name) {
      unregisterDeferredIsland(this._name, this);
    }
  }

  _members(): GroupMember[] {
    return [...(members.get(this._groupId) ?? [])];
  }

  /** The group name plus every distinct member `name`, so `deferReloadState` follows the round under either handle. */
  _notify(change: { ok?: boolean } = {}) {
    const names = new Set<string>();
    if (this._name) {
      names.add(this._name);
    }
    for (const member of this._members()) {
      if (member._name) {
        names.add(member._name);
      }
    }
    for (const name of names) {
      notifyDeferredIslandChange(name, change);
    }
  }

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

  /**
   * One reload round however many handles ask for it: `reloadDeferredIsland(name)` over a group of twelve named members
   * calls this twelve times and all twelve share one request. Queued behind any round already running rather than
   * joining it, so a reload issued after a mutation observes it — the same contract a lone island's reload has.
   */
  reload(): Promise<boolean> {
    if (!this._coalesced) {
      this._coalesced = this._track(
        (this._inflight ?? Promise.resolve(true)).then(() => {
          // Cleared as the round starts, so anything arriving later queues behind it instead of joining it.
          this._coalesced = null;
          return this._reload();
        }),
      );
    }
    return this._coalesced;
  }

  async _reload(): Promise<boolean> {
    const els = this._members() as unknown as Element[];
    for (const el of els) {
      el.setAttribute('data-reloading', '');
      el.setAttribute('aria-busy', 'true');
    }
    try {
      // The current content stays up until the new HTML lands, so hydrated children keep their client state.
      return await this._fetchGroup();
    } finally {
      for (const el of els) {
        el.removeAttribute('data-reloading');
        el.removeAttribute('aria-busy');
      }
    }
  }

  isReloading(): boolean {
    return this._inflight !== null;
  }

  /** Every chunk in parallel; one chunk failing its whole retry budget fails the round without holding up the others. */
  async _fetchGroup(): Promise<boolean> {
    const results = await Promise.all(this._chunks.map((chunk) => this._fetchChunk(chunk)));
    this._everLoaded ||= results.some(Boolean);
    return results.every(Boolean);
  }

  async _fetchChunk(chunk: string): Promise<boolean> {
    const assetPrefix = this.getAttribute('data-asset-prefix') ?? '';
    const url = `${assetPrefix}/island-group/${encodeURIComponent(this._name)}?g=${chunk}`;
    const tag = `[mochi] Island group "${this._name}"`;
    const ll = window.__mochi_log_level;

    if (url.length > 1800) {
      window.__mochi_warn?.(`${tag} URL is ${url.length} chars. Consider reducing prop size or splitting the group.`);
    }

    const maxRetries = typeof this._options.retries === 'number' ? this._options.retries : 9;

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
        const payload = (await response.json()) as GroupResponse;
        const byId = payload.m ?? {};

        if (ll === 'log' || ll === 'debug') {
          console.log(`${tag} loaded ${Object.keys(byId).length} islands (attempt ${attempt}, ${(JSON.stringify(byId).length / 1024).toFixed(1)}kB)`);
        }

        for (const member of this._members()) {
          const html = byId[member.getAttribute('group-member') ?? ''];
          if (html !== undefined) {
            member._applyHtml(html);
          }
        }
        return true;
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && 'abort' in err) {
          // A 4xx is deterministic, so the loop stops rather than burning the retry budget on it.
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
    return false;
  }
}

if (!customElements.get('mochi-island-group')) {
  customElements.define('mochi-island-group', IslandGroup);
}
